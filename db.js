const Sequelize = require('sequelize');

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");
const { MESSAGES } = require("./message.js");

module.exports = function (sequelize, DateTypes) {

    sequelize.REGIONI_CHOICES = REGIONI.CHOICES;

    sequelize.CATEGORIES_CHOICES = CATEGORIES.CHOICES;

    sequelize.WATCH_REPLY = MESSAGES.WATCH;
    sequelize.SEARCH_REPLY = MESSAGES.SEARCH;
    sequelize.EVENT_REPLY = MESSAGES.EVENT;
    sequelize.CANCEL_REPLY = MESSAGES.CANCEL;

    sequelize.BC_STATUS_CHOICES = [
        'OK', 'INCOMPLETE', 'BC_ERROR', 'NET_ERROR', 'PARSE_ERROR', 'DB_ERROR', 'OTHER_ERROR'
    ]

    const db = {
        Op: Sequelize.Op,
        sequelize: sequelize,
    };

    db.BCLog = sequelize.define('bc_log', {
        status: {
            type: Sequelize.ENUM,
            values: sequelize.BC_STATUS_CHOICES,
        },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        special: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        events: {
            type: Sequelize.SMALLINT,
            defaultValue: 0,
        }
    }, {});

    db.BCEvent = sequelize.define('bc_event', {
        bc: {
            type: Sequelize.INTEGER,
            allowNull: false,
            unique: true,
            field: "bc_id",
        },
        category: {
            type: Sequelize.ENUM,
            values: sequelize.CATEGORIES_CHOICES
        },
        regione: {
            type: Sequelize.ENUM,
            values: sequelize.REGIONI_CHOICES
        },
        title: { type: Sequelize.STRING(100) },
        startdate: { type: Sequelize.DATE },
        enddate: { type: Sequelize.DATE },
        subscriptiondate: { type: Sequelize.DATE },
        endsubscriptiondate: { type: Sequelize.DATE },
        cost: { type: Sequelize.SMALLINT },
        location: { type: Sequelize.STRING(50) },
        collectiondate: { type: Sequelize.DATE },
        hasBeenWatched: {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            field: "watched",
        },
    }, {});

    db.Watcher = sequelize.define('watcher', {
        chatID: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        msgID: {
            type: Sequelize.BIGINT,
            field: "msg_id",
        },
        category: {
            type: Sequelize.ENUM,
            values: sequelize.CATEGORIES_CHOICES,
            allowNull: false,
        },
        regione: {
            type: Sequelize.ENUM,
            values: sequelize.REGIONI_CHOICES,
            allowNull: true,
        },
        expiredate: { type: Sequelize.DATE },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
    }, {});

    db.Reply = sequelize.define('reply', {
        type: {
            type: Sequelize.ENUM,
            values: [
                sequelize.WATCH_REPLY, sequelize.SEARCH_REPLY,
                sequelize.EVENT_REPLY, sequelize.CANCEL_REPLY,
            ],
        },
        chatID: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        data: {
            type: Sequelize.JSONB,
        },
    }, {});

    db.Watcher.belongsTo(db.Reply, {foreignKey: 'reply_id'});
    db.Reply.hasOne(db.Watcher, {foreignKey: 'reply_id'});

    db.Alarm = sequelize.define('alarm', {
        warning: {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
        },
        status: {
            type: Sequelize.SMALLINT,
            defaultValue: 0,
        },
    }, {});

    db.Alarm.belongsTo(db.BCEvent, { onDelete: 'cascade', foreignKey: 'eventId' });
    db.BCEvent.hasMany(db.Alarm, { foreignKey: 'eventId' });
    db.Alarm.belongsTo(db.Reply, { onDelete: 'cascade' });
    db.Reply.hasMany(db.Alarm);

    db.TGMessage = sequelize.define('message', {
        tgID: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "telegram_id",
            unique: true,
        }
    })
    db.TGMessage.belongsTo(db.Reply, { onDelete: 'cascade' });
    db.Reply.hasMany(db.TGMessage);

    return db

}
