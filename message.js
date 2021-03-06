const WELCOME = 1;
const STATUS = 2;
const ABOUT = 3;
const LOG = 4;
const WARNING = 5;
const ONFOUND = 10;
const SEARCH = "S";
const WATCH = "W";
const MEMO_SUB = 'M1';
const MEMO_START = 'M2';
const MEMO_END = 'M3';
const EVENT = "E";
const CANCEL = "C";
const SHOW = 99;

const MESSAGES = {

    WELCOME: WELCOME,
    STATUS: STATUS,
    ABOUT: ABOUT,
    LOG: LOG,
    SEARCH: SEARCH,
    WATCH: WATCH,
    MEMO_SUB: MEMO_SUB,
    MEMO_END: MEMO_END,
    MEMO_START: MEMO_START,
    EVENT: EVENT,
    CANCEL: CANCEL,
    SHOW: SHOW,
    ONFOUND: ONFOUND,

    SHOW_BETA_ALERT: (process.env.SHOW_BETA_ALERT == 1) || true,

    callBackSet: new Set([SEARCH, WATCH, EVENT, CANCEL]),
    withBetaAlertSet: new Set([WELCOME, WARNING, SEARCH, WATCH, CANCEL, ABOUT]),
    prioritySet: new Set([WELCOME, SEARCH, WATCH, CANCEL, WARNING, ONFOUND, MEMO_SUB]),
    HTMLSet: new Set([
        WELCOME, STATUS, ABOUT, SEARCH, WATCH, EVENT, SHOW, CANCEL, ONFOUND, ABOUT, STATUS, MEMO_START, MEMO_SUB, MEMO_END,
    ]),

}

const BRANCHE_SELECTION = 1;
const CAT_SELECTION = 2
const ZONES_SELECTION = 3;
const REG_SELECTION = 4;
const COMPLETE_SELECTION = 5;

SELECTION = {
    BRANCA: BRANCHE_SELECTION,
    CATEGORY: CAT_SELECTION,
    ZONE: ZONES_SELECTION,
    REGIONE: REG_SELECTION,
    COMPLETE: COMPLETE_SELECTION,

    callbackData: function (type, b = '', c = '', z = '', r = '') {
        return `${type}/select/${b}/${c}/${z}/${r}`;
    }
}

module.exports = { MESSAGES, SELECTION };
