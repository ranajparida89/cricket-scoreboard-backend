// routes/scheduler.js
const express = require('express');
const router = express.Router();
const {
  generateCrossBoardFixtures,
  shuffleWithGap
} = require('./schedulerService');

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

    const rawFixtures = generateCrossBoardFixtures(boards);
    const gap = Number.isInteger(options.enforceGap) ? options.enforceGap : 1;
    const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 300;
    const shuffled = shuffleWithGap(rawFixtures, gap, maxAttempts);

    for (let i = 0; i < shuffled.length; i++) {
      const m = shuffled[i];
      const label = `${m.teamA} (${m.boardA}) vs ${m.teamB} (${m.boardB})`;
      await client.query(
        `INSERT INTO cr_fixture (series_id, team1, team1_board, team2, team2_board, position, match_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [series.id, m.teamA, m.boardA, m.teamB, m.boardB, i + 1, label]
      );
    }

    await client.query('COMMIT');

    const fixturesRes = await client.query(
      'SELECT id, position AS match_id, team1, team1_board, team2, team2_board, match_label FROM cr_fixture WHERE series_id=$1 ORDER BY position',
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

module.exports = router;
