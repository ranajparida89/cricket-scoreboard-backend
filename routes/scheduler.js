// routes/scheduler.js
const express = require('express');
const router = express.Router();
const {
  generateCrossBoardFixtures,
  shuffleWithGap
} = require('./schedulerService');

// ===============================
// SMART STRATEGY DECISION ENGINE
// ===============================

function decideStrategy(totalTeams) {
  const fullRRMatches = totalTeams * (totalTeams - 1) / 2;

  // If match count small → allow full round robin
  if (fullRRMatches <= 80) {
    return "FULL_ROUND_ROBIN";
  }

  // Otherwise use group stage
  return "GROUP_STAGE";
}

function generateFullRoundRobin(boards) {
  const teams = [];

  boards.forEach(b => {
    b.teams.forEach(t => {
      teams.push({ team: t.trim(), board: b.name.trim() });
    });
  });

  const fixtures = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      fixtures.push({
        teamA: teams[i].team,
        boardA: teams[i].board,
        teamB: teams[j].team,
        boardB: teams[j].board
      });
    }
  }

  return fixtures;
}

function generateGroupStage(boards) {
  const teams = [];

  boards.forEach(b => {
    b.teams.forEach(t => {
      teams.push({ team: t.trim(), board: b.name.trim() });
    });
  });

  const groupSize = 6;
  const groups = [];

  for (let i = 0; i < teams.length; i += groupSize) {
    groups.push(teams.slice(i, i + groupSize));
  }

  const fixtures = [];

  groups.forEach((group, gIndex) => {

    const groupName = `Group ${String.fromCharCode(65 + gIndex)}`;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        fixtures.push({
          group: groupName,
          teamA: group[i].team,
          boardA: group[i].board,
          teamB: group[j].team,
          boardB: group[j].board
        });
      }
    }
  });

  return fixtures;
}

const multer = require('multer');
const XLSX = require('xlsx');

// Excel Upload Storage (Memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.post('/series', async (req, res) => {
  const db = req.app.get('db');
  const { matchName, boards = [], options = {} } = req.body;

  if (!matchName || !boards.length) {
    return res.status(400).json({ error: 'matchName and boards are required' });
  }

  for (const b of boards) {
    if (!b.name || !Array.isArray(b.teams) || b.teams.length === 0) {
      return res.status(400).json({ error: 'Each board must have name and non-empty teams[]' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const seriesRes = await client.query(
      'INSERT INTO cr_series (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [matchName]
    );
    let series;
    if (seriesRes.rows.length === 0) {
      const r = await client.query('SELECT * FROM cr_series WHERE name=$1', [matchName]);
      series = r.rows[0];
      await client.query('DELETE FROM cr_fixture WHERE series_id=$1', [series.id]);
      await client.query('DELETE FROM cr_series_team WHERE series_id=$1', [series.id]);
      await client.query('DELETE FROM cr_series_board WHERE series_id=$1', [series.id]);
    } else {
      series = seriesRes.rows[0];
    }

    const boardIdByName = new Map();
    for (const b of boards) {
      const br = await client.query(
        'INSERT INTO cr_series_board (series_id, name) VALUES ($1, $2) RETURNING *',
        [series.id, b.name.trim()]
      );
      boardIdByName.set(b.name.trim(), br.rows[0].id);
    }

    for (const b of boards) {
      const boardId = boardIdByName.get(b.name.trim());
      for (const t of b.teams) {
        await client.query(
          'INSERT INTO cr_series_team (series_id, board_id, name) VALUES ($1, $2, $3)',
          [series.id, boardId, t.trim()]
        );
      }
    }

    // Count total teams
    let totalTeams = 0;
    boards.forEach(b => totalTeams += b.teams.length);

    // Decide tournament strategy
    const strategy = decideStrategy(totalTeams);

    let rawFixtures;

    if (strategy === "FULL_ROUND_ROBIN") {
      rawFixtures = generateFullRoundRobin(boards);
    } else {
      rawFixtures = generateGroupStage(boards);
    }
    const gap = Number.isInteger(options.enforceGap) ? options.enforceGap : 1;
    const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 300;
    const shuffled = shuffleWithGap(rawFixtures, gap, maxAttempts);

    for (let i = 0; i < shuffled.length; i++) {
      const m = shuffled[i];
      const label = `${m.teamA} (${m.boardA}) vs ${m.teamB} (${m.boardB})`;
      await client.query(
        `INSERT INTO cr_fixture 
   (series_id, team1, team1_board, team2, team2_board, position, match_label, match_group)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          series.id,
          m.teamA,
          m.boardA,
          m.teamB,
          m.boardB,
          i + 1,
          label,
          m.group || null
        ]
      );

    }

    await client.query('COMMIT');

    const fixturesRes = await client.query(
      'SELECT id, position AS match_id, team1, team1_board, team2, team2_board, match_label, match_group FROM cr_fixture WHERE series_id=$1 ORDER BY position',
      [series.id]
    );

    res.json({
      series: { id: series.id, name: series.name },
      total_matches: fixturesRes.rowCount,
      fixtures: fixturesRes.rows
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Scheduler error:', e);
    res.status(500).json({ error: 'Failed to create schedule', details: e.message });
  } finally {
    client.release();
  }
});

router.get('/series', async (req, res) => {
  const db = req.app.get('db');
  const r = await db.query('SELECT id, name, created_at FROM cr_series ORDER BY created_at DESC');
  res.json(r.rows);
});

router.get('/series/:seriesId/fixtures', async (req, res) => {
  const db = req.app.get('db');
  const { seriesId } = req.params;
  const r = await db.query(
    'SELECT id, position AS match_id, team1, team1_board, team2, team2_board, match_label FROM cr_fixture WHERE series_id=$1 ORDER BY position',
    [seriesId]
  );
  res.json(r.rows);
});

// ✅ UPDATE MATCH STATUS (Excel Fixture)
router.put('/excel/status/:id', async (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['NOT_PLAYED', 'COMPLETED', 'CANCELLED', 'WALKOVER'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 🔹 Update fixture status
    const updateRes = await client.query(
      `UPDATE cr_excel_fixture
       SET status = $1
       WHERE id = $2
       RETURNING fixture_group_id`,
      [status, id]
    );

    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const groupId = updateRes.rows[0].fixture_group_id;

    // 🔹 Check if any match still NOT_PLAYED
    const pendingRes = await client.query(
      `SELECT COUNT(*) 
       FROM cr_excel_fixture
       WHERE fixture_group_id = $1
       AND status = 'NOT_PLAYED'`,
      [groupId]
    );

    const pendingCount = parseInt(pendingRes.rows[0].count);

    // 🔥 If no pending matches → complete tournament
    if (pendingCount === 0) {
      await client.query(
        `UPDATE cr_excel_group
         SET tournament_status = 'COMPLETED',
             is_active = false
         WHERE id = $1`,
        [groupId]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Status Update Error:', err);
    res.status(500).json({ error: 'Failed to update match status' });
  } finally {
    client.release();
  }
});

// ✅ UPLOAD EXCEL FIXTURES (Dynamic JSON Storage)
router.post('/excel/upload/:seriesId', upload.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const { seriesId } = req.params;
  // Validate series exists
  const seriesCheck = await db.query(
    'SELECT id FROM cr_series WHERE id = $1',
    [seriesId]
  );

  if (seriesCheck.rowCount === 0) {
    return res.status(404).json({ error: 'Series not found' });
  }


  if (!req.file) {
    return res.status(400).json({ error: 'Excel file is required' });
  }

  try {
    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ error: 'Excel file has no data' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 🔥 Important: Replace existing fixtures of this series
      await client.query(
        'DELETE FROM cr_excel_fixture WHERE series_id = $1',
        [seriesId]
      );

      for (const row of rows) {
        await client.query(
          `INSERT INTO cr_excel_fixture (series_id, row_data)
           VALUES ($1, $2)`,
          [seriesId, row]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `${rows.length} fixtures uploaded successfully`,
        total: rows.length
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Excel Upload Error:', err);
    res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

// ✅ UPLOAD EXCEL FIXTURES (Independent Group)
router.post('/excel/upload', upload.single('file'), async (req, res) => {
  const db = req.app.get('db');

  if (!req.file) {
    return res.status(400).json({ error: 'Excel file is required' });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ error: 'Excel file has no data' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 🔥 Deactivate previous RUNNING tournament
      await client.query(`
          UPDATE cr_excel_group
          SET is_active = false
          WHERE tournament_status = 'RUNNING'
          AND is_active = true
        `);

      // 🔥 Create new active RUNNING tournament
      const groupIdRes = await client.query(
        `INSERT INTO cr_excel_group (tournament_status, is_active)
   VALUES ('RUNNING', true)
   RETURNING id`
      );

      // ✅ DEFINE groupId HERE
      const groupId = groupIdRes.rows[0].id;

      // 🔥 Insert fixtures using that groupId
      for (const row of rows) {
        await client.query(
          `INSERT INTO cr_excel_fixture (fixture_group_id, row_data)
     VALUES ($1, $2)`,
          [groupId, row]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        fixture_group_id: groupId,
        total: rows.length
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Excel Upload Error:', err);
    res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

// ✅ GET ACTIVE RUNNING TOURNAMENT (Independent Excel)
router.get('/excel/active', async (req, res) => {
  const db = req.app.get('db');

  try {
    const groupRes = await db.query(
      `SELECT id
       FROM cr_excel_group
       WHERE tournament_status = 'RUNNING'
       AND is_active = true
       ORDER BY id DESC
       LIMIT 1`
    );

    if (groupRes.rowCount === 0) {
      return res.json({ success: true, data: [] });
    }

    const groupId = groupRes.rows[0].id;

    const fixturesRes = await db.query(
      `SELECT id, row_data, status, winner, remarks
       FROM cr_excel_fixture
       WHERE fixture_group_id = $1
       ORDER BY id ASC`,
      [groupId]
    );

    res.json({
      success: true,
      data: fixturesRes.rows
    });

  } catch (err) {
    console.error('Active Tournament Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch active tournament' });
  }
});

// ✅ GET LAST COMPLETED TOURNAMENT
router.get('/excel/completed', async (req, res) => {
  const db = req.app.get('db');

  try {
    const groupRes = await db.query(
      `SELECT id
       FROM cr_excel_group
       WHERE tournament_status = 'COMPLETED'
       ORDER BY id DESC
       LIMIT 1`
    );

    if (groupRes.rowCount === 0) {
      return res.json({ success: true, data: [] });
    }

    const groupId = groupRes.rows[0].id;

    const fixturesRes = await db.query(
      `SELECT id, row_data, status, winner, remarks
       FROM cr_excel_fixture
       WHERE fixture_group_id = $1
       ORDER BY id ASC`,
      [groupId]
    );

    res.json({
      success: true,
      data: fixturesRes.rows
    });

  } catch (err) {
    console.error('Completed Tournament Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch completed tournament' });
  }
});

// ✅ GET ALL TOURNAMENT HISTORY
router.get('/excel/history', async (req, res) => {
  const db = req.app.get('db');

  try {
    const result = await db.query(`
      SELECT 
        g.id,
        g.tournament_status,
        g.created_at,
        COUNT(f.id) as total_matches,
        COUNT(CASE WHEN f.status != 'NOT_PLAYED' THEN 1 END) as played_matches
      FROM cr_excel_group g
      LEFT JOIN cr_excel_fixture f 
        ON g.id = f.fixture_group_id
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `);

    res.json({ success: true, data: result.rows });

  } catch (err) {
    console.error('History Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch tournament history' });
  }
});

// ✅ GET FIXTURES BY GROUP ID (For History View)
router.get('/excel/group/:groupId', async (req, res) => {
  const db = req.app.get('db');
  const { groupId } = req.params;

  try {
    const result = await db.query(
      `SELECT id, row_data, status, winner, remarks
       FROM cr_excel_fixture
       WHERE fixture_group_id = $1
       ORDER BY id ASC`,
      [groupId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error('Group Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch tournament fixtures' });
  }
});

// =====================================
// UPCOMING FIXTURES FOR HOMEPAGE
// =====================================

router.get('/excel/upcoming-home', async (req, res) => {
  const db = req.app.get('db');
  try {
    // Active Tournament
    const groupRes = await db.query(`
SELECT id
FROM cr_excel_group
WHERE tournament_status='RUNNING'
AND is_active=true
ORDER BY id DESC
LIMIT 1
`);
    if (groupRes.rowCount === 0) {
      return res.json({ matches: [] });
    }
    const groupId = groupRes.rows[0].id;
    // Pending Matches
    const fixturesRes = await db.query(`
SELECT
row_data,
status
FROM cr_excel_fixture
WHERE fixture_group_id=$1
AND status='NOT_PLAYED'
ORDER BY id ASC
LIMIT 20
`, [groupId]);

    res.json({
      matches: fixturesRes.rows
    });

  } catch (err) {
    console.log(err);
    res.status(500).json(err);
  }
});

module.exports = router;
