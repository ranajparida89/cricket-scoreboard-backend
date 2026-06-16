const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =====================================================
   HEALTH CHECK
===================================================== */
router.get("/health", async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            message: "Player Achievement API is working",
        });
    } catch (err) {
        console.error("Health Check Error:", err);

        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/* =====================================================
   DATABASE TEST
===================================================== */
router.get("/master-test", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT COUNT(*) FROM achievement_master"
        );

        res.status(200).json({
            success: true,
            data: result.rows,
        });
    } catch (err) {
        console.error("Master Test Error:", err);

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
        });
    }
});

/* =====================================================
   GET ALL ACHIEVEMENT MASTER RECORDS
===================================================== */
router.get("/master", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT *
      FROM achievement_master
      WHERE is_active = TRUE
      ORDER BY achievement_category, achievement_name
    `);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });
    } catch (err) {
        console.error("Master Fetch Error:", err);

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
            stack: err.stack,
        });
    }
});

/* =====================================================
   GET ACHIEVEMENTS BY CATEGORY
===================================================== */
router.get("/master/:category", async (req, res) => {
    try {
        const { category } = req.params;

        const result = await pool.query(
            `
      SELECT *
      FROM achievement_master
      WHERE is_active = TRUE
      AND LOWER(achievement_category) = LOWER($1)
      ORDER BY achievement_name
      `,
            [category]
        );

        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });
    } catch (err) {
        console.error("Category Fetch Error:", err);

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
            stack: err.stack,
        });
    }
});

/* =====================================================
   REGISTER PLAYER ACHIEVEMENT
===================================================== */
router.post("/register", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const {
            match_id,
            match_type,
            match_name,
            board_name,
            team_name,
            player_name,
            achievement_category,
            achievement_name,
            achievement_date,
            innings_type,

            runs_scored,
            balls_faced,
            fours,
            sixes,

            wickets,
            runs_conceded,
            overs_bowled,

            consecutive_wickets,
            balls_for_wickets,

            catches,
            stumpings,
            run_outs,

            remarks,
            created_by,
        } = req.body;

        /* ==========================
           VALIDATION
        ========================== */

        const requiredFields = [
            "match_id",
            "match_type",
            "match_name",
            "team_name",
            "player_name",
            "achievement_category",
            "achievement_name",
            "achievement_date",
        ];

        const missingFields = [];

        requiredFields.forEach((field) => {
            if (!req.body[field]) {
                missingFields.push(field);
            }
        });

        if (missingFields.length > 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "Missing required fields",
                missingFields,
            });
        }

        /* ==========================
           DUPLICATE CHECK
        ========================== */

        const duplicateCheck = await client.query(
            `
      SELECT id
      FROM player_achievements
      WHERE LOWER(TRIM(player_name)) = LOWER(TRIM($1))
      AND LOWER(TRIM(match_id)) = LOWER(TRIM($2))
      AND LOWER(TRIM(achievement_name)) = LOWER(TRIM($3))
      LIMIT 1
      `,
            [
                player_name,
                match_id,
                achievement_name,
            ]
        );

        if (duplicateCheck.rows.length > 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message:
                    "Duplicate achievement already exists for this player in this Match ID.",
            });
        }

        /* ==========================
           FETCH MASTER DATA
        ========================== */

        const masterResult = await client.query(
            `
      SELECT *
      FROM achievement_master
      WHERE achievement_name = $1
      AND is_active = TRUE
      LIMIT 1
      `,
            [achievement_name]
        );

        if (masterResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Achievement not found in achievement_master.",
            });
        }

        const master = masterResult.rows[0];

        const achievement_points = master.points || 0;
        const rarity_level = master.rarity_level || "Common";

        /* ==========================
           GENERATE ACHIEVEMENT ID
        ========================== */

        const year = new Date().getFullYear();

        const countResult = await client.query(
            `
      SELECT COUNT(*) AS total
      FROM player_achievements
      `
        );

        const nextNumber =
            parseInt(countResult.rows[0].total || 0) + 1;

        const achievement_id =
            `PA-${year}-${String(nextNumber).padStart(6, "0")}`;

        /* ==========================
           INSERT RECORD
        ========================== */

        const insertResult = await client.query(
            `
      INSERT INTO player_achievements
(
        achievement_id,

        match_id,
        match_type,
        match_name,

        board_name,
        team_name,
        player_name,

        achievement_category,
        achievement_name,

        achievement_date,

        innings_type,

        runs_scored,
        balls_faced,
        fours,
        sixes,

        wickets,
        runs_conceded,
        overs_bowled,

        consecutive_wickets,
        balls_for_wickets,

        catches,
        stumpings,
        run_outs,

        achievement_points,
        rarity_level,

        remarks,
        created_by
      )
      VALUES
        (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,$26,$27
        )
      RETURNING *
      `,
            [
                achievement_id,

                match_id,
                match_type,
                match_name,

                board_name,
                team_name,

                player_name,

                achievement_category,
                achievement_name,

                achievement_date,

                innings_type || null,

                runs_scored || 0,
                balls_faced || 0,
                fours || 0,
                sixes || 0,

                wickets || 0,
                runs_conceded || 0,
                overs_bowled || null,

                consecutive_wickets || 0,
                balls_for_wickets || 0,

                catches || 0,
                stumpings || 0,
                run_outs || 0,

                achievement_points,
                rarity_level,

                remarks || null,
                created_by || "System",
            ]
        );

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            message: "Achievement registered successfully.",
            achievement: insertResult.rows[0],
        });

    } catch (err) {
        await client.query("ROLLBACK");

        console.error("Achievement Register Error:", err);

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
        });
    } finally {
        client.release();
    }
});

/* =====================================================
   GET ALL ACHIEVEMENTS
===================================================== */
router.get("/all", async (req, res) => {
    try {
        const {
            playerName,
            matchType,
            achievement,
            category,
            status,
            rarity,
            page = 1,
            limit = 20,
        } = req.query;

        const conditions = [];
        const values = [];
        let idx = 1;

        if (playerName) {
            conditions.push(`LOWER(player_name) LIKE LOWER($${idx})`);
            values.push(`%${playerName}%`);
            idx++;
        }

        if (matchType) {
            conditions.push(`LOWER(match_type)=LOWER($${idx})`);
            values.push(matchType);
            idx++;
        }

        if (achievement) {
            conditions.push(`LOWER(achievement_name) LIKE LOWER($${idx})`);
            values.push(`%${achievement}%`);
            idx++;
        }

        if (category) {
            conditions.push(`LOWER(achievement_category)=LOWER($${idx})`);
            values.push(category);
            idx++;
        }

        if (status) {
            conditions.push(`LOWER(status)=LOWER($${idx})`);
            values.push(status);
            idx++;
        }

        if (rarity) {
            conditions.push(`LOWER(rarity_level)=LOWER($${idx})`);
            values.push(rarity);
            idx++;
        }

        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        const offset =
            (parseInt(page) - 1) * parseInt(limit);

        const totalQuery = `
      SELECT COUNT(*) AS total
      FROM player_achievements
      ${whereClause}
    `;

        const totalResult = await pool.query(
            totalQuery,
            values
        );

        const dataQuery = `
      SELECT *
      FROM player_achievements
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx}
      OFFSET $${idx + 1}
    `;

        const dataResult = await pool.query(
            dataQuery,
            [
                ...values,
                parseInt(limit),
                parseInt(offset),
            ]
        );

        res.status(200).json({
            success: true,

            totalRecords:
                parseInt(totalResult.rows[0].total),

            currentPage:
                parseInt(page),

            pageSize:
                parseInt(limit),

            totalPages:
                Math.ceil(
                    parseInt(totalResult.rows[0].total) /
                    parseInt(limit)
                ),

            data: dataResult.rows,
        });

    } catch (err) {
        console.error(
            "Get All Achievements Error:",
            err
        );

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
        });
    }
});
/* =====================================================
   UPDATE ACHIEVEMENT
===================================================== */
router.put("/update/:achievementId", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const { achievementId } = req.params;

        const existing = await client.query(
            `
      SELECT *
      FROM player_achievements
      WHERE achievement_id = $1
      `,
            [achievementId]
        );

        if (existing.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Achievement not found",
            });
        }

        const achievement_name =
            req.body.achievement_name ||
            existing.rows[0].achievement_name;

        let achievement_points =
            existing.rows[0].achievement_points;

        let rarity_level =
            existing.rows[0].rarity_level;

        const master = await client.query(
            `
      SELECT *
      FROM achievement_master
      WHERE achievement_name = $1
      LIMIT 1
      `,
            [achievement_name]
        );

        if (master.rows.length > 0) {
            achievement_points =
                master.rows[0].points;

            rarity_level =
                master.rows[0].rarity_level;
        }

        const result = await client.query(
            `
      UPDATE player_achievements
      SET

      match_type = COALESCE($1, match_type),
      match_name = COALESCE($2, match_name),

      board_name = COALESCE($3, board_name),
      team_name = COALESCE($4, team_name),

      player_name = COALESCE($5, player_name),

      achievement_category = COALESCE($6, achievement_category),
      achievement_name = COALESCE($7, achievement_name),

      achievement_date = COALESCE($8, achievement_date),

      innings_type = COALESCE($9, innings_type),

      runs_scored = COALESCE($10, runs_scored),
      balls_faced = COALESCE($11, balls_faced),
      fours = COALESCE($12, fours),
      sixes = COALESCE($13, sixes),

      wickets = COALESCE($14, wickets),
      runs_conceded = COALESCE($15, runs_conceded),
      overs_bowled = COALESCE($16, overs_bowled),

      consecutive_wickets = COALESCE($17, consecutive_wickets),
      balls_for_wickets = COALESCE($18, balls_for_wickets),

      catches = COALESCE($19, catches),
      stumpings = COALESCE($20, stumpings),
      run_outs = COALESCE($21, run_outs),

      achievement_points = $22,
      rarity_level = $23,

      status = COALESCE($24, status),

      remarks = COALESCE($25, remarks),

      updated_at = NOW()

      WHERE achievement_id = $26

      RETURNING *
      `,
            [
                req.body.match_type,
                req.body.match_name,

                req.body.board_name,
                req.body.team_name,

                req.body.player_name,

                req.body.achievement_category,
                req.body.achievement_name,

                req.body.achievement_date,

                req.body.innings_type,

                req.body.runs_scored,
                req.body.balls_faced,
                req.body.fours,
                req.body.sixes,

                req.body.wickets,
                req.body.runs_conceded,
                req.body.overs_bowled,

                req.body.consecutive_wickets,
                req.body.balls_for_wickets,

                req.body.catches,
                req.body.stumpings,
                req.body.run_outs,

                achievement_points,
                rarity_level,

                req.body.status,

                req.body.remarks,

                achievementId,
            ]
        );

        await client.query("COMMIT");

        res.status(200).json({
            success: true,
            message: "Achievement updated successfully",
            achievement: result.rows[0],
        });

    } catch (err) {
        await client.query("ROLLBACK");

        console.error(
            "Achievement Update Error:",
            err
        );

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
        });
    } finally {
        client.release();
    }
});
/* =====================================================
   DELETE ACHIEVEMENT
===================================================== */
router.delete("/delete/:achievementId", async (req, res) => {
    try {
        const { achievementId } = req.params;

        const result = await pool.query(
            `
      DELETE FROM player_achievements
      WHERE achievement_id = $1
      RETURNING *
      `,
            [achievementId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Achievement not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Achievement deleted successfully",
            achievement: result.rows[0],
        });

    } catch (err) {
        console.error("Delete Achievement Error:", err);

        res.status(500).json({
            success: false,
            message: err.message,
            code: err.code,
        });
    }
});
/* =====================================================
   DASHBOARD SUMMARY
===================================================== */
router.get("/dashboard", async (req, res) => {
    try {

        const totalAchievements = await pool.query(`
      SELECT COUNT(*) total
      FROM player_achievements
    `);

        const verifiedAchievements = await pool.query(`
      SELECT COUNT(*) total
      FROM player_achievements
      WHERE status='Verified'
    `);

        const hallOfFame = await pool.query(`
      SELECT COUNT(*) total
      FROM player_achievements
      WHERE status='Hall Of Fame'
    `);

        const legendaryAchievements = await pool.query(`
      SELECT COUNT(*) total
      FROM player_achievements
      WHERE rarity_level IN ('Legendary','Mythical','Historic')
    `);

        res.json({
            success: true,

            totalAchievements:
                parseInt(totalAchievements.rows[0].total),

            verifiedAchievements:
                parseInt(verifiedAchievements.rows[0].total),

            hallOfFame:
                parseInt(hallOfFame.rows[0].total),

            legendaryAchievements:
                parseInt(legendaryAchievements.rows[0].total),
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message,
        });
    }
});
/* =====================================================
   TOP ACHIEVEMENT PLAYERS
===================================================== */
router.get("/top-players", async (req, res) => {
    try {

        const result = await pool.query(`
      SELECT
        player_name,
        COUNT(*) total_achievements,
        SUM(achievement_points) total_points
      FROM player_achievements
      GROUP BY player_name
      ORDER BY total_points DESC
      LIMIT 20
    `);

        res.json({
            success: true,
            data: result.rows,
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message,
        });
    }
});
/* =====================================================
   HALL OF FAME RECORDS
===================================================== */
router.get("/hall-of-fame", async (req, res) => {
    try {

        const result = await pool.query(`
      SELECT *
      FROM player_achievements
      WHERE status='Hall Of Fame'
      ORDER BY achievement_points DESC
    `);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message,
        });
    }
});
/* =====================================================
   ACHIEVEMENT STATISTICS
===================================================== */
router.get("/statistics", async (req, res) => {
    try {

        const categoryStats = await pool.query(`
      SELECT
        achievement_category,
        COUNT(*) total
      FROM player_achievements
      GROUP BY achievement_category
      ORDER BY total DESC
    `);

        const rarityStats = await pool.query(`
      SELECT
        rarity_level,
        COUNT(*) total
      FROM player_achievements
      GROUP BY rarity_level
      ORDER BY total DESC
    `);

        const matchTypeStats = await pool.query(`
      SELECT
        match_type,
        COUNT(*) total
      FROM player_achievements
      GROUP BY match_type
      ORDER BY total DESC
    `);

        res.json({
            success: true,
            categoryStats: categoryStats.rows,
            rarityStats: rarityStats.rows,
            matchTypeStats: matchTypeStats.rows,
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message,
        });
    }
});

/* =====================================================
   GET ACHIEVEMENT BY ID
===================================================== */
router.get("/:achievementId", async (req, res) => {
    try {
        const { achievementId } = req.params;

        const result = await pool.query(
            `
      SELECT *
      FROM player_achievements
      WHERE achievement_id = $1
      `,
            [achievementId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Achievement not found",
            });
        }

        res.status(200).json({
            success: true,
            achievement: result.rows[0],
        });

    } catch (err) {
        console.error(
            "Get Achievement By ID Error:",
            err
        );

        res.status(500).json({
            success: false,
            message: err.message,
            detail: err.detail,
            code: err.code,
        });
    }
});
// =====================================
// GET DISTINCT TOURNAMENTS
// =====================================
router.get("/tournaments/:matchType", async (req, res) => {
    try {

        const { matchType } = req.params;

        let result;

        if (
            matchType.toUpperCase() === "TEST"
        ) {

            result = await pool.query(`
        SELECT DISTINCT tournament_name
        FROM test_match_results
        WHERE tournament_name IS NOT NULL
        ORDER BY tournament_name
      `);

        } else {

            result = await pool.query(`
        SELECT DISTINCT tournament_name
        FROM match_history
        WHERE tournament_name IS NOT NULL
        ORDER BY tournament_name
      `);

        }

        res.json({
            success: true,
            tournaments: result.rows,
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message,
        });

    }
});
module.exports = router;