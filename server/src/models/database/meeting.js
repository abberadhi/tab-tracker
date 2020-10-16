require('dotenv').config();
const user = require('./user');
const mysql = require("promise-mysql");
let db;

(async function() {
    db = await mysql.createConnection({
        "host":     "localhost",
        "user":     process.env.DB_USER,
        "password": process.env.DB_PASS,
        "database": "meetx",
        "dateStrings": "date",
        "multipleStatements": true
    });

    process.on("exit", () => {
        db.end();
    });
})();

module.exports = {
    "createMeeting": async (
        title, 
        description, 
        location, 
        meetingDate, 
        meetingTimeStart, 
        meetingTimeEnd,
        organizer,
        attendees,
        req
        ) => {

        // methods inserts meeting and everything relate into the database        
        // add meeting to meeting table and get the ID
        await db.query(`
        INSERT INTO meeting (
            title, 
            description, 
            organizer_id, 
            location) 
            VALUES (
                ?, 
                ?, 
                "${organizer}", 
                ?);
        SELECT LAST_INSERT_ID()`, [
            title,
            description,
            location
        ]).then(async (res) => {
            req.flash('success_msg', {
                message: `Meeting created successfully`
            });

            let meetingID = res[0].insertId;
            
            // add attendees to meetingAttendees table
            // check if attandees is array, if not make it an array
            if (!Array.isArray(attendees)) {
                attendees = [attendees];
            }

            for (let i = 0; i < attendees.length; i++) {
                console.log("Checking: ", attendees[i]);
                
                // check if user is registered
                // get the user;
                await db.query(`SELECT * FROM users WHERE email = ?;`, [attendees[i]])
                    .then(async (fetchedUser) => {
                        if (fetchedUser.length > 0) {
                            // Only if user didn't add themselves. 
                            if (fetchedUser[0].id !== organizer) {
                                await db.query(`
                                INSERT INTO meetingAttendees 
                                    (meeting_id, user_id, seen) 
                                VALUES
                                    (${meetingID}, "${fetchedUser[0].id}", 0)`)
                            }
                        } else {
                            console.log("User Does not exist: ", attendees[i]);
                            req.flash('error_msg', {
                                message: `Warning: Could not find user ${attendees[i]}, therefore ignored.`
                            });
                        }
                    });
            }

            // add organizer as attendee
            await db.query(`
            INSERT INTO meetingAttendees 
                (meeting_id, user_id, seen) 
            VALUES
                (${meetingID}, "${organizer}", 1)`);


            // add the suggested times
            // if array = multiple dates
            if (!Array.isArray(meetingDate)) {
                let start = new Date(`${meetingDate} ${meetingTimeStart}`).toISOString().slice(0, 19).replace('T', ' ');;
                let end = new Date(`${meetingDate} ${meetingTimeEnd}`).toISOString().slice(0, 19).replace('T', ' ');;

                await db.query(`
                INSERT INTO pollChoice
                    (meeting_id, added_by, meeting_date_start, meeting_date_end, final)
                VALUES
                    (?, "${organizer}", "${start}", "${end}", ?)`, [meetingID, 1]);
            } else {
                // insert every date choice to the database
                for (let i = 0; i < meetingDate.length; i++) {
                    let start;
                    let end;
                    try {
                        start = new Date(`${meetingDate[i]} ${meetingTimeStart[i]}`).toISOString().slice(0, 19).replace('T', ' ');;
                        end = new Date(`${meetingDate[i]} ${meetingTimeEnd[i]}`).toISOString().slice(0, 19).replace('T', ' ');;
                    } catch (err) {
                        console.log("Error! ", err);
                        continue;
                    }

                    await db.query(`
                    INSERT INTO pollChoice
                        (meeting_id, added_by, meeting_date_start, meeting_date_end, final)
                    VALUES
                        (?, "${organizer}", "${start}", "${end}", ?)`, [meetingID, 0]);
                }
            }

        }).catch((err) => {
            req.flash('error_msg', {
                message: `ERROR: Could not create meeting.: ${err}`
            });
        });
    },
    "getFinalMeetings": async (id) => {
        let res = await db.query(`
        SELECT
        m.id,
        m.title,
        m.location,
        a.user_id,
        pc.final,
        pc.meeting_date_start,
        pc.meeting_date_end,
        a.seen,
        (SELECT COUNT(*) FROM meetingAttendees WHERE meeting_id = m.id) as attendeesCounter,
        (SELECT COUNT(*) FROM pollVote WHERE pollChoice_id = pc.id AND user_id = a.user_id) AS votes,
        (SELECT TIMEDIFF(pc.meeting_date_end, now()) > 0) as active,
        (SELECT COUNT(*) FROM pollVote
        LEFT JOIN pollChoice
        ON pollVote.pollChoice_id = pollChoice.id
        WHERE pollVote.user_id = "${id}" AND pollChoice.meeting_id = m.id 
        ) as voted 
        FROM meeting AS m
        INNER JOIN meetingAttendees AS a
        ON m.id = a.meeting_id
        INNER JOIN pollChoice AS pc
        ON pc.meeting_id = m.id
        WHERE a.user_id = "${id}";

        `);
        
        return res;
    },
    "isAllowedToMeeting": async (u_id, m_id) => {
        let sql = `
        SELECT (COUNT(*)>0) as allowed 
        FROM meetingAttendees 
        WHERE meeting_id = ? AND 
        user_id = "${u_id}";
        `;

        let res = await db.query(sql, [m_id]);

        return res[0].allowed;
    },
    "setSeenMeeting": async (u_id, m_id) => {
        await db.query(`
        UPDATE meetingAttendees SET seen = 1 
        WHERE meeting_id = ? AND 
        user_id = "${u_id}" 
        `, [m_id]);
    },
    "getMeetingById": async (m_id) =>  {
        // get meeting details
        let meeting = {
            details: await db.query(`
                SELECT * FROM meeting WHERE id = ?`, [m_id]),
            attendees: await db.query(`
            SELECT * FROM meetingAttendees AS a
            INNER JOIN users AS u
            ON a.user_id = u.id
            WHERE a.meeting_id = ?;`, [m_id])
        };

        console.log("meeting", meeting)

        //get pollChoices

        return meeting;
    }
}
