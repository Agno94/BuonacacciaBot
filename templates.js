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
 Promemoria relativi a questo eventi: 🔕 <i>Disattivi</i>`

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
Non ho trovato <b>nessun</b> evento con le caratteristiche richieste`;
    if (p.status === "end") return `
Ho trovato ed inviato <b>${p.count}</b> eventi del tipo cercato`
    else return `
Ho trovato <b>${p.count}</b> del tipo che mi hai chiesto.
Se clicci <i>Mostra risultati</i> ti manderò dei messaggi con i dettagli di questi eventi, 1 messaggio per evento.`
}

SELECTION_STATUS = {};
SELECTION_STATUS[SELECTION.BRANCA] = (p) => `
▪️ <i>Scelta branca</i>`;
SELECTION_STATUS[SELECTION.CATEGORY] = (p) => `
${p.emoji || '▪️'} <i>Scelta categoria</i>`;
SELECTION_STATUS[SELECTION.ZONE] = (p) => `
${CATEGORIES.EMOJI(p.cat)} <b>${CATEGORIES[p.cat].human}</b> ▪️ <i>Scelta zona</i>`;
SELECTION_STATUS[SELECTION.REGIONE] = (p) => `
${CATEGORIES.EMOJI(p.cat)} <b>${CATEGORIES[p.cat].human}</b> ▪️ ${(p.zone && ZONES[p.zone].human) || ''} <i>Scelta regione</i>`;
SELECTION_STATUS[SELECTION.COMPLETE] = (p) => `
${CATEGORIES.EMOJI(p.cat)} <b>${CATEGORIES[p.cat].human}</b> 🔹 <b>${REGIONI[p.reg].human}</b>`;

SELECTION_HELP = {};
SELECTION_HELP[SELECTION.BRANCA] = `
<b>Seleziona</b> la branca o la categoria che ti interessa`;
SELECTION_HELP[SELECTION.CATEGORY] = `
<b>Seleziona</b> la categoria dell'evento che ti interessa`;
SELECTION_HELP[SELECTION.ZONE] = `
<b>Scegli</b> una zona d'Italia in cui si trova la 🌍 regione che organizza l'evento oppure scegli eventi organizzati a livello 🇮🇹nazionale`;
SELECTION_HELP[SELECTION.REGIONE] = `
<b>Scegli</b> che 🌍 regione organizza l'evento`;
SELECTION_HELP[SELECTION.COMPLETE] = ''

TEMPLATES[MESSAGES.SEARCH] = (p) => `
🔍 Ricerca di eventi ${SELECTION_STATUS[p.step](p)}

Con questa funzione cerco degli degli eventi presenti su <b>${BClink}</b>.
Rispondo con gli eventi trovati l'ultima volta che ho visitato Buonacaccia(controllo per nuovi eventi più volte ogni giorno), se invece vuoi rimanere aggiornato scrivimi <u>\/osserva</u>
${SELECTION_HELP[p.step]}${SearchResult(p)}`;

TEMPLATES[MESSAGES.SHOW] = (p) => `
Rimangono ancora <b>${p.count}</b> eventi da mostrare
Per vederli scrivimi <u>/mostra</u>. Oppure scrivi <u>/mostra 5</u> per vedere i primi 5.`


TEMPLATES[MESSAGES.WATCH] = (p) => {
    msg = `
👀 Osservatore di eventi ${SELECTION_STATUS[p.step](p)}

    Con questa funzione per farmi controllare degli eventi presenti su ${BClink}. Mi ricorderò che ti interessano di eventi del tipo selezionato e ti invierò in messaggio quando trovo nuovi eventi sul sito. Se invece ti interessa sapere gli eventi presenti ora usa <u>\/cerca</u>.
${SELECTION_HELP[p.step]}`
    if (p.step == SELECTION.COMPLETE) {
        if (p.status == 'active') msg += `
✔️🔔 Osservatore creato ed attivo.

Quando non vuoi più ricevere avvisi usa il testo sotto o scrivimi <u>/annulla</u>`
        if (p.status == 'cancelled') msg += `
❌🔕 Osservatore eliminato e disattivo`
        if (p.status == 'expired') msg += `
⌛️🔕 Osservatore disattivo in quanto scaduto`
    }
    return msg
}

TEMPLATES[MESSAGES.CANCEL] = (p) => {
    function createList(list) {
        if (!list.length) return "nessun elemento presente"
        return list.reduce((msg, element) => msg + `
🔸 ${element}`, "")
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
