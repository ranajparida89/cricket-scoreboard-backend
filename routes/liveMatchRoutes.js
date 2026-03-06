const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

function generateEmbedUrl(url) {

    if (!url) return null;

    if (url.includes("youtube.com/watch")) {
        const videoId = url.split("v=")[1].split("&")[0];
        return "https://www.youtube.com/embed/" + videoId + "?autoplay=1";
    }

    if (url.includes("youtu.be")) {
        const videoId = url.split("youtu.be/")[1];
        return "https://www.youtube.com/embed/" + videoId + "?autoplay=1";
    }

    if (url.includes("twitch.tv")) {
        const channel = url.split("twitch.tv/")[1];
        return "https://player.twitch.tv/?channel=" + channel + "&parent=localhost";
    }

    return url;
}


// START LIVE MATCH
router.post("/start", async (req, res) => {

    try {

        console.log("STEP 1 - Request received");
        console.log("BODY:", req.body);

        const {
            match_name,
            team1,
            team2,
            match_type,
            stream_url,
            created_by
        } = req.body;

        console.log("STEP 2 - Fields extracted");

        if (!match_name || !team1 || !team2 || !match_type || !stream_url) {

            console.log("STEP 3 - Validation failed");

            return res.status(400).json({
                success: false,
                message: "Missing required fields"
            });

        }

        const embed_url = generateEmbedUrl(stream_url) || stream_url;

        console.log("STEP 4 - Embed URL generated:", embed_url);

        const result = await pool.query(
            "INSERT INTO live_matches (match_name,team1,team2,match_type,stream_url,embed_url,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [match_name, team1, team2, match_type, stream_url, embed_url, created_by]
        );

        console.log("STEP 5 - First insert success");

        const match = result.rows[0];

        console.log("STEP 6 - Match ID:", match.id);

        await pool.query(
            "INSERT INTO live_match_stats (match_id,total_views,peak_viewers) VALUES ($1,0,0)",
            [match.id]
        );

        console.log("STEP 7 - Stats insert success");

        res.json({
            success: true,
            match
        });

    } catch (err) {

        console.error("LIVE MATCH ERROR:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

});

// GET ALL LIVE MATCHES
router.get("/live", async (req, res) => {

    try {

        const result = await pool.query(
            "SELECT * FROM live_matches WHERE status='LIVE' ORDER BY start_time DESC"
        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// GET SINGLE MATCH
router.get("/:id", async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(
            "SELECT * FROM live_matches WHERE id=$1",
            [id]
        );

        res.json(result.rows[0]);

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// END MATCH
router.post("/end/:id", async (req, res) => {

    try {

        const { id } = req.params;

        await pool.query(
            "UPDATE live_matches SET status='ENDED', end_time=NOW() WHERE id=$1",
            [id]
        );

        res.json({
            success: true,
            message: "Match ended"
        });

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// VIEWER JOIN
router.post("/viewer-join", async (req, res) => {

    try {

        const { match_id, viewer_id } = req.body;

        await pool.query(
            "INSERT INTO live_match_viewers (match_id, viewer_id) VALUES ($1,$2)",
            [match_id, viewer_id]
        );

        await pool.query(
            "UPDATE live_match_stats SET total_views = total_views + 1 WHERE match_id=$1",
            [match_id]
        );

        res.json({ success: true });

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// VIEWER COUNT
router.get("/viewers/:match_id", async (req, res) => {

    try {

        const { match_id } = req.params;

        const result = await pool.query(
            "SELECT COUNT(*) AS viewers FROM live_match_viewers WHERE match_id=$1",
            [match_id]
        );

        res.json(result.rows[0]);

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// SEND CHAT MESSAGE
router.post("/chat", async (req, res) => {

    try {

        const { match_id, username, message } = req.body;

        await pool.query(
            "INSERT INTO live_match_chat (match_id, username, message) VALUES ($1,$2,$3)",
            [match_id, username, message]
        );

        res.json({ success: true });

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});


// GET CHAT MESSAGES
router.get("/chat/:match_id", async (req, res) => {

    try {

        const { match_id } = req.params;

        const result = await pool.query(
            "SELECT * FROM live_match_chat WHERE match_id=$1 ORDER BY created_at DESC LIMIT 50",
            [match_id]
        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);
        res.status(500).json({ success: false });

    }

});

module.exports = router;