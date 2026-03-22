const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

////////////////////////////////////////////////////////////
//// CREATE ANNOUNCEMENT
////////////////////////////////////////////////////////////

router.post("/create", async (req, res) => {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        const {
            title,
            content,
            category,
            is_pinned,
            expiry_date,
            created_by
        } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: "Title and content required"
            });
        }

        const id = uuidv4();

        await client.query(

            `INSERT INTO announcements
(
id,
title,
content,
category,
is_pinned,
expiry_date,
created_by,
created_at
)

VALUES
($1,$2,$3,$4,$5,$6,$7,NOW())`,

            [
                id,
                title,
                content,
                category || 'General',
                is_pinned || false,
                expiry_date || null,
                created_by || null
            ]

        );

        await client.query("COMMIT");

        res.json({

            success: true,
            message: "Announcement created",
            id: id

        });

    }
    catch (err) {

        await client.query("ROLLBACK");

        console.log(err);

        res.status(500).json({

            success: false,
            message: "Server error"

        });

    }
    finally {

        client.release();

    }

});

////////////////////////////////////////////////////////////
//// GET ALL ANNOUNCEMENTS
////////////////////////////////////////////////////////////

router.get("/all", async (req, res) => {

    try {

        const result = await pool.query(

            `SELECT *,
CASE
WHEN created_at > NOW() - INTERVAL '48 HOURS'
THEN true
ELSE false
END as is_new

FROM announcements

WHERE is_published = true

ORDER BY
is_pinned DESC,
created_at DESC`

        );

        res.json(result.rows);

    }
    catch (err) {

        console.log(err);

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// GET SINGLE ANNOUNCEMENT
////////////////////////////////////////////////////////////

router.get("/:id", async (req, res) => {

    try {

        const { id } = req.params;

        await pool.query(

            `UPDATE announcements
SET views = views + 1
WHERE id=$1`,
            [id]

        );

        const result = await pool.query(

            `SELECT * FROM announcements
WHERE id=$1`,
            [id]

        );

        res.json(result.rows[0]);

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// DELETE
////////////////////////////////////////////////////////////

router.delete("/delete/:id", async (req, res) => {

    try {

        await pool.query(

            `DELETE FROM announcements
WHERE id=$1`,

            [req.params.id]

        );

        res.json({

            success: true,
            message: "Deleted"

        });

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// UPDATE
////////////////////////////////////////////////////////////

router.put("/update/:id", async (req, res) => {

    try {

        const {
            title,
            content,
            category,
            is_pinned,
            is_published,
            expiry_date
        } = req.body;

        await pool.query(

            `UPDATE announcements

SET
title=$1,
content=$2,
category=$3,
is_pinned=$4,
is_published=$5,
expiry_date=$6,
updated_at=NOW()

WHERE id=$7`,

            [
                title,
                content,
                category,
                is_pinned,
                is_published,
                expiry_date,
                req.params.id
            ]

        );

        res.json({

            success: true,
            message: "Updated"

        });

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// SEARCH
////////////////////////////////////////////////////////////

router.get("/search/text/:text", async (req, res) => {

    try {

        const text = req.params.text;

        const result = await pool.query(

            `SELECT *

FROM announcements

WHERE

title ILIKE $1

OR

content ILIKE $1

ORDER BY created_at DESC`,

            ['%' + text + '%']

        );

        res.json(result.rows);

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// PIN TOGGLE
////////////////////////////////////////////////////////////

router.put("/pin/:id", async (req, res) => {

    try {

        await pool.query(

            `UPDATE announcements

SET is_pinned = NOT is_pinned

WHERE id=$1`,

            [req.params.id]

        );

        res.json({

            success: true,
            message: "Pin updated"

        });

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});

////////////////////////////////////////////////////////////
//// PUBLISHED TOGGLE
////////////////////////////////////////////////////////////

router.put("/publish/:id", async (req, res) => {

    try {

        await pool.query(

            `UPDATE announcements

SET is_published = NOT is_published

WHERE id=$1`,

            [req.params.id]

        );

        res.json({

            success: true,
            message: "Publish status changed"

        });

    }
    catch (err) {

        res.status(500).json({

            message: "error"

        });

    }

});
module.exports = router;