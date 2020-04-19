const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");
const { MESSAGES, SELECTION } = require("./message.js");

const BClink = `<a href="https://buonacaccia.net/">BuonaCaccia</a>`;

const TEMPLATES = {};

TEMPLATES.BetaAlert = `
<b>⚠️ Attenzione</b>: questo bot è in <i>fase di sviluppo e collaudo</i> 🚧`;

TEMPLATES[MESSAGES.WELCOME] = (p) => `
Il mio obiettivo è aiutare capi e ragazzi scout ad avere a che fare con ${BClink}
In futuro potrò: aiutarti a cercare eventi, avvisarti quando compaiono nuovi eventi che ti interessano, avvisarti quando stanno per aprire le iscrizioni ad un campetto, ecc...
Attualmente sono disponibili queste funzioni:
🔸<u>/cerca</u> - Posso cercare eventi tra quelli presenti su buonacaccia l'ultima volta che ho visitato il sito
🔸<u>/osserva</u> - Posso avvisarti quando compare su buonacaccia un evento che ti interessa`

TEMPLATES[MESSAGES.EVENT] = (p) => `
<i>Evento</i>: <b>${p.event.title}</b>
|Tipo: ${BRANCHE[CATEGORIES[p.event.category].branca].emoji}${
    CATEGORIES[p.event.category].human}|Regione: 🌍${REGIONI[p.event.regione].human}|
📍 Luogo: ${p.event.location}
✈️ Partenza: ${new Date(p.event.startdate).toLocaleDateString()}
🏁 Ritorno: ${new Date(p.event.enddate).toLocaleDateString()}
🔓 Apertura iscrizioni: ${new Date(p.event.subscriptiondate).toLocaleDateString()}
🔒 Chiusura iscrizioni: ${new Date(p.event.endsubscriptiondate).toLocaleDateString()}
💰️ Costo: ${p.event.cost / 100} €
<a href="https://buonacaccia.net/event.aspx?e=${p.event.bcId}">🔗 <b>Link</b> dettagli ed iscrizione</a>
 Promemoria relativi a questo eventi: 🔕 <i>Disattivati</i>`
// 🔔

function CategorySelection(cmd) {
    return BRANCHE.LIST.reduce(
        (msg, branca) => msg + branca.CATEGORIES.reduce(
            (msg, category) =>
                msg + `\n ${branca.emoji} » <u>/${cmd}_${category.code}</u> per <i>${category.human}</i> `
            , `\n Eventi <b>${branca.human}</b> ${branca.emoji}: `)
        , `\nSeleziona quale categoria di evento ti interessa: `)
}

function RegioniSelection() {
    return ZONES.LIST.slice(1).reduce((msg, zone) => {
        let msg_regioni = zone.REGIONI.reduce((lista_regioni, regione) => {
            return lista_regioni + `
- <u>/regione_${regione.command}</u> per la regione <i>${regione.human}</i>`
        }, "")
        return msg + `
📌️ Regioni zona ${zone.human}:`
            + msg_regioni
    }, "\nDimmi quale regione organizza l'evento che ti interessa:`")
        + `
🇮🇹️ eventi organizzati dal nazionale
- <u>/nazionale</u>`
}

SEARCH_END = (p) => `\n
Per iniziare una nuova ricerca scrivi <u>/cerca</u>.
Se invece vuoi che ti tenga aggiornato riguardo ad nuovi eventi di questo tipo scrivi
<u>/osserva_${p.cat}_${REGIONI[p.reg].command}</u> o <code>/osserva ${p.cat} ${REGIONI[p.reg].command}</code>`

function SearchResult(p) {
    if (p.step < SELECTION.ZONE) return '';
    if (p.step < SELECTION.COMPLETE) {
        if (p.list && p.list.length) 
            return p.list.reduce((msg, info) => {
            return msg + `
- la regione <i>${REGIONI[info.regione].human}</i> ha <b>${info.count}</b> eventi`
        }, "\n\nDel tipo selezionato, in database:");
        else return "\n\nNessun evento di questo tipo nel database";
    }
    if (!p.count) return `
Non ho trovato <b>nessun</b> evento con le caratteristiche richieste` + SEARCH_END(p)
    if (p.many) return `
Ho trovato molti eventi, <b>${p.count}</b> per l'esatezza, del tipo che mi hai chiesto.
Per vederli scrivimi <u>/mostra</u>. Oppure scrivi <u>/mostra 5</u> per vedere i primi 5.` + SEARCH_END(p)
    return `
Ha ricerca ha trovato <b>${p.count}</b> eventi` + SEARCH_END(p)
}

SELECTION_STATUS = {};
SELECTION_STATUS[SELECTION.CATEGORY] = (p) => `
▪️ <i>Scelta categoria</i>`;
SELECTION_STATUS[SELECTION.REGIONE] = (p) => `
${p.emoji} <b>${CATEGORIES[p.cat].human}</b> ▪️ <i>Scelta regione</i>`;
SELECTION_STATUS[SELECTION.COMPLETE] = (p) => `
${p.emoji} <b>${CATEGORIES[p.cat].human}</b> 🔹 <b>${REGIONI[p.reg].human}</b>`;

SELECTION_BODY = {};
SELECTION_BODY[SELECTION.CATEGORY] = (p,cmd) => CategorySelection(cmd);
SELECTION_BODY[SELECTION.REGIONE] = (p,cmd) => RegioniSelection();
SELECTION_BODY[SELECTION.COMPLETE] = (p,cmd) => ""

TEMPLATES[MESSAGES.SEARCH] = (p) => `
🔍 Ricerca di eventi ${SELECTION_STATUS[p.step](p)}
Con questa funzione cerco degli degli eventi presenti su <b>${BClink}</b>.
Rispondo con gli eventi trovati l'ultima volta che ho visitato Buonacaccia(controllo per nuovi eventi più volte ogni giorno), se invece vuoi rimanere aggiornato scrivimi <u>\/osserva</u>
${SELECTION_BODY[p.step](p,'cerca')}${SearchResult(p)}`;

TEMPLATES[MESSAGES.SHOW] = (p) => `
Rimangono ancora <b>${p.count}</b> eventi da mostrare
Per vederli scrivimi <u>/mostra</u>. Oppure scrivi <u>/mostra 5</u> per vedere i primi 5.`

TEMPLATES[MESSAGES.WATCH] = (p) => {
    msg = `
👀 Osservatore di eventi ${SELECTION_STATUS[p.step](p)}
Con questa funzione per farmi controllare degli eventi presenti su <b>${BClink}</b>.
Mi ricorderò che ti interessano di eventi del tipo selezionato e ti invierò in messaggio quando trovo nuovi eventi sul sito.
Se invece ti interessa sapere gli eventi presenti ora usa <u>\/cerca</u>.
${SELECTION_BODY[p.step](p,"osserva")}`
    if (p.step == SELECTION.COMPLETE) msg += `
✔️🔔 Osservatore creato ed attivo.

Quando non vuoi più ricevere questi messaggi scrivimi <u>/annulla_${p.id}</u>`
    return msg
}

TEMPLATES[MESSAGES.CANCEL] = (p) => {
    function createList(list) {
        if (!list.length) return "nessun elemento presente"
        return list.reduce( (msg, element) => msg + `
🔸 ${element}`,"")
    }
    return `
🗑 Rimozione di promemoria ed osservatori

Se vuoi che non ti mandi più promemoria per eventi o avvisi quando un osservatore trova un evento che ti intessa clicca sotto.
Per disattivare i promemoria per i singoli eventi o gli avvisi per i singoli osservatori, usa tasti nel messaggio corrispondente.
Se non hai più i messaggi posso rimandarli.

Elenco degli osservatori attivi: ${createList(p.watchers)}

Elenco degli eventi con promemoria attivo: ${createList(p.alarmEvents)}`
}

module.exports = { TEMPLATES }
