// ✅ routes/forumRoutes.js
// Purpose: CrickEdge Talk – public forum (read) + authenticated posting

const router = require("express").Router();
const pool = require("../db");
const authenticateToken = require("./authenticateToken");

/* ----------------- helpers ----------------- */
const countWords = (text = "") =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

/* =========================================================
 * GET /api/forum/posts (PUBLIC)
 * ======================================================= */
router.get("/posts", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        author_name,
        subject,
        content,
        post_type,
        TO_CHAR(created_at, 'YYYY-MM-DD')       AS post_date,
        TRIM(TO_CHAR(created_at, 'FMDay'))      AS post_day,
        TRIM(TO_CHAR(created_at, 'HH12:MI AM')) AS post_time
      FROM forum_posts
      WHERE is_deleted = FALSE
      ORDER BY created_at DESC
    `);

    return res.json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Forum Posts Error:", err);
    return res.status(500).json({
      error: "Server error while fetching forum posts",
    });
  }
});

/* =========================================================
 * POST /api/forum/post (AUTH)
 * ======================================================= */
router.post("/post", authenticateToken, async (req, res) => {
  console.log("📩 Create forum post:", req.body);

  const { subject, content, postType } = req.body;
  const user_id = req.user?.user_id;
  const author_name = req.user?.email;

  if (!user_id) {
    return res.status(401).json({
      error: "User not authenticated. Please login again.",
    });
  }

  if (!subject || !content || !postType) {
    return res.status(400).json({
      error: "Subject, content, and post type are required",
    });
  }

  if (!["STORY", "COMMENT"].includes(postType)) {
    return res.status(400).json({
      error: "Invalid post type",
    });
  }

  const wordLimit = postType === "STORY" ? 2000 : 800;
  if (countWords(content) > wordLimit) {
    return res.status(400).json({
      error: `Word limit exceeded. Max allowed is ${wordLimit} words.`,
    });
  }

  try {
    await pool.query(
      `
      INSERT INTO forum_posts
        (user_id, author_name, subject, content, post_type)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [user_id, author_name, subject, content, postType]
    );

    return res.json({
      message: "Forum post created successfully",
    });
  } catch (err) {
    console.error("❌ Create Forum Post Error:", err);
    return res.status(500).json({
      error: "Server error while creating forum post",
    });
  }
});

/* =========================================================
 * GET /api/forum/replies/:postId (PUBLIC)
 * ======================================================= */
router.get("/replies/:postId", async (req, res) => {
    console.log("🔍 FETCH REPLIES postId:", req.params.postId);
  const { postId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        author_name,
        content,
        TO_CHAR(created_at, 'YYYY-MM-DD')       AS reply_date,
        TRIM(TO_CHAR(created_at, 'FMDay'))      AS reply_day,
        TRIM(TO_CHAR(created_at, 'HH12:MI AM')) AS reply_time
      FROM forum_replies
      WHERE post_id = $1
        AND is_deleted = FALSE
      ORDER BY created_at ASC
      `,
      [postId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Replies Error:", err);
    return res.status(500).json({
      error: "Server error while fetching replies",
    });
  }
});

/* =========================================================
 * POST /api/forum/reply (AUTH)
 * ======================================================= */
router.post("/reply", authenticateToken, async (req, res) => {
  console.log("💬 Add forum reply:", req.body);

  const { postId, content } = req.body;
 const user_id = req.user?.user_id;
  const author_name = req.user?.email;

  if (!user_id) {
    return res.status(401).json({
      error: "User not authenticated. Please login again.",
    });
  }

  if (!postId || !content) {
    return res.status(400).json({
      error: "Post ID and reply content are required",
    });
  }

  if (countWords(content) > 800) {
    return res.status(400).json({
      error: "Word limit exceeded. Max allowed is 800 words.",
    });
  }

  try {
    await pool.query(
      `
      INSERT INTO forum_replies
        (post_id, user_id, author_name, content)
      VALUES ($1, $2, $3, $4)
      `,
      [postId, user_id, author_name, content]
    );

    return res.json({
      message: "Reply added successfully",
    });
  } catch (err) {
    console.error("❌ Add Reply Error:", err);
    return res.status(500).json({
      error: "Server error while adding reply",
    });
  }
});

/* =========================================================
 * PUT /api/forum/post/:id (EDIT POST – OWNER ONLY)
 * ======================================================= */
router.put("/post/:id", authenticateToken, async (req, res) => {
  const postId = req.params.id;
  const { subject, content } = req.body;
  const user_id = req.user?.user_id;

  if (!user_id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const postRes = await pool.query(
      "SELECT user_id FROM forum_posts WHERE id = $1 AND is_deleted = FALSE",
      [postId]
    );

    if (postRes.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (postRes.rows[0].user_id !== user_id) {
      return res.status(403).json({ error: "Not allowed to edit this post" });
    }

    await pool.query(
      `
      UPDATE forum_posts
      SET subject = $1,
          content = $2,
          updated_at = NOW()
      WHERE id = $3
      `,
      [subject, content, postId]
    );

    res.json({ message: "Post updated successfully" });
  } catch (err) {
    console.error("❌ Update Post Error:", err);
    res.status(500).json({ error: "Failed to update post" });
  }
});

/* =========================================================
 * DELETE /api/forum/post/:id (DELETE POST – OWNER ONLY)
 * ======================================================= */
router.delete("/post/:id", authenticateToken, async (req, res) => {
  const postId = req.params.id;
  const user_id = req.user?.user_id;

  if (!user_id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const postRes = await pool.query(
      "SELECT user_id FROM forum_posts WHERE id = $1 AND is_deleted = FALSE",
      [postId]
    );

    if (postRes.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (postRes.rows[0].user_id !== user_id) {
      return res.status(403).json({ error: "Not allowed to delete this post" });
    }

    await pool.query(
      "UPDATE forum_posts SET is_deleted = TRUE WHERE id = $1",
      [postId]
    );

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Post Error:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

/* =========================================================
 * POST /api/forum/post/:postId/like (AUTH)
 * ======================================================= */
router.post(
  "/post/:postId/like",
  authenticateToken,
  async (req, res) => {
     console.log("🔥 LIKE API HIT");
     console.log("🔥 req.user =", req.user);
    const { postId } = req.params;
    const user_id = req.user?.user_id;

    console.log("LIKE DEBUG → postId:", postId, "user_id:", user_id, "type:", typeof user_id);

    
    console.log("👉 postId =", postId);
    console.log("👉 extracted user_id =", user_id);
    console.log("LIKE req.user =", req.user);

    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      // Check if already liked
      const existing = await pool.query(
        "SELECT id FROM forum_likes WHERE post_id = $1 AND user_id = $2",
        [postId, user_id]
      );

      if (existing.rows.length > 0) {
        // Unlike
        await pool.query(
          "DELETE FROM forum_likes WHERE post_id = $1 AND user_id = $2",
          [postId, user_id]
        );
        return res.json({ liked: false });
      }

      // Like
      await pool.query(
        "INSERT INTO forum_likes (post_id, user_id) VALUES ($1, $2)",
        [postId, user_id]
      );

      res.json({ liked: true });
    } catch (err) {
      console.error("❌ Like error:", err);
      res.status(500).json({ error: "Failed to like post" });
    }
  }
);

/* =========================================================
 * GET /api/forum/post/:postId/likes (PUBLIC)
 * ======================================================= */
router.get("/post/:postId/likes", async (req, res) => {
  const { postId } = req.params;

  try {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS likes FROM forum_likes WHERE post_id = $1",
      [postId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Like count error:", err);
    res.status(500).json({ error: "Failed to fetch likes" });
  }
});


module.exports = router;
