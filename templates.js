const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");

const html_mode = { parse_mode: 'HTML' };
const BClink = `<a href="https://buonacaccia.net/">BuonaCaccia</a>`;

const TEMPLATES = {

    BetaAlert: `
<b>⚠️ Attenzione</b>: questo bot è in <i>fase di sviluppo e collaudo</i> 🚧`,
    objBetaAlert: html_mode,

    Welcome: function () {
        return this.BetaAlert + `
Il mio obiettivo è aiutare capi e ragazzi scout ad avere a che fare con ${BClink}
In futuro potrò: aiutarti a cercare eventi, avvisarti quando compaiono nuovi eventi che ti interessano, avvisarti quando stanno per aprire le iscrizioni ad un campetto, ecc...
Attualmente sono disponibili queste funzioni:
🔸<u>/cerca</u> - Posso cercare eventi tra quelli presenti su buonacaccia l'ultima volta che ho visitato il sito
🔸<u>/osserva</u> - Posso avvisarti quando compare su buonacaccia un evento che ti interessa
`
    },
    objWelcome: html_mode,

    /*   OldCategoryOptions: (cmd) =>
          CATEGORIES.LIST.reduce((msg, category) => {
              let branca = BRANCHE.LIST[category.branca - 1];
              return msg + `
  <u>/${cmd}_${category.code}</u> per <i>${branca.human}</i>${branca.emoji} » ${category.human}`;
          }, `\nSeleziona quale categoria di evento ti interessa: `), */

    CategoryOptions: function (cmd) {
        return BRANCHE.LIST.reduce(
            (msg, branca) => msg + branca.CATEGORIES.reduce(
                (msg, category) =>
                    msg + `\n ${branca.emoji} » <u>/${cmd}_${category.code}</u> per <i>${category.human}</i> `
                , `\n Eventi <b>${branca.human}</b> ${branca.emoji}: `)
            , `\nSeleziona quale categoria di evento ti interessa: `)
    },

    SearchHelp: function (name) {
        return this.BetaAlert + `
Ciao ${name || ""},
🔍 vuoi che cerchi degli eventi sul database di <b>${BClink}</b>?
Ti risponderò con gli eventi trovati l'ultima volta che ho visitato Buonacaccia, se vuoi rimanere aggiornato scrivimi <u>\/osserva</u>
` +
            this.CategoryOptions("cerca")
    },
    objSearchHelp: html_mode,

    WatchHelp: function (name) {
        return this.BetaAlert + `
Ciao ${name || ""}, 
👀 vuoi che controlli ogni giorno gli eventi eventi sul database di <b>${BClink}</b>?
Mi ricorderò che ti interessano di eventi del tipo che mi dirai e ti invierò in messaggio quando trovo nuovi eventi sul sito. 
Se invece ti interessa sapere gli eventi presenti ora usa <u>\/cerca</u>.
` +
            this.CategoryOptions("osserva")
    },
    objWatchHelp: html_mode,

    AskRegione: `
Dimmi quale regione organizza l'evento che ti interessa:`
        + ZONES.LIST.slice(1).reduce((msg, zone) => {
            let msg_regioni = zone.REGIONI.reduce((lista_regioni, regione) => {
                // let human = REGIONI[regione].human;
                // let command = REGIONI[regione].command;
                return lista_regioni + `
- <u>/regione_${regione.command}</u> per la regione <i>${regione.human}</i>`
            }, "")
            return msg + `
📌️ Regioni zona ${zone.human}:`
                + msg_regioni
        }, "")
        + `
🇮🇹️ eventi organizzati dal nazionale
- <u>/nazionale</u>
🌐️ tutti gli eventi
- <u>/tutti</u> 
`,
    objAskRegione: html_mode,

    MultiSelectionWarning: (type, c, list) => {
        let emoji;
        if (type == "search") {
            emoji = "🔍";
        } else if (type == "watch") {
            emoji = "👀";
        }
        let m = `⚠️ La selezione di più regioni non è stata implementata. 🚧
${emoji} Per favore seleziona una sola regione.
 Del tipo <i>${CATEGORIES[c].human}</i> in database:`
        return list.reduce((msg, info) => {
            return msg + `
- la regione <i>${REGIONI[info.regione].human}</i> ha <b>${info.count}</b> eventi`
        }, m);
    },
    objMultiSelectionWarning: html_mode,

    SearchEnd: (c, r) => {
        let regione_cmd = REGIONI[r].command;
        return `
🔍 Ti ho risposto in base agli eventi presenti l'ultima volta che ho visitato buonacaccia.net`
            + ` (controllo per nuovi eventi più volte ogni giorno)`
            + ` Se vuoi che ti tenga aggiornato riguardo ad nuovi eventi di questo tipo scrivi
 <u>/osserva_${c}_${regione_cmd}</u> o <code>/osserva ${c} ${regione_cmd}</code>`;
    },
    objSearchEnd: html_mode,

    NoSearchResult: function (c, r) {
        return `
🔍 Non ho trovato <b>nessun</b> evento con le caratteristiche richieste` +
            this.SearchEnd(c, r)
    },
    objNoSearchResult: html_mode,

    ShowResultsHelp: `
Per vederli scrivimi <u>/mostra</u>. Oppure scrivi <u>/mostra 5</u> per vedere i primi 5.`,
    objShowResultHelp: html_mode,

    OtherResults: function (l) {
        return `
Rimangono ancora <b>${l}</b> eventi da mostrare`
            + this.ShowResultsHelp
    },
    objOtherResults: html_mode,

    SearchManyResults: function (l) {
        return `
🔍 Ho trovato molti eventi, <b>${l}</b> per l'esatezza, del tipo che mi hai chiesto.`
            + this.ShowResultsHelp
    },
    objSearchManyResults: html_mode,

    WatcherCreation: function (c, r, id) {
        let cat_h = CATEGORIES[c].human;
        let reg_h = REGIONI[r].human;
        return `
👀 Tipo <b>${cat_h}</b> della regione <b>${reg_h}</b>
Se troverò un evento di questo tipo ti avviserò con un messaggio.
Quando non vuoi più ricevere questi messaggi scrivimi <u>/annulla ${id}</u>
`
    },
    objWatcherCreation: html_mode,

    event2HTML: (event) => {
        let cat = CATEGORIES[event.category];
        let msg = `<i>Evento</i>: <b>${event.title}</b>
|Tipo: ${BRANCHE[cat.branca].emoji}${cat.human}|Regione: 🌍${REGIONI[event.regione].human}|
   📍 Luogo: ${event.location}
   ✈️ Partenza: ${new Date(event.startdate).toLocaleDateString()}
   🏁 Ritorno: ${new Date(event.enddate).toLocaleDateString()}
   🔓 Apertura iscrizioni: ${new Date(event.subscriptiondate).toLocaleDateString()}
   🔒 Chiusura iscrizioni: ${new Date(event.endsubscriptiondate).toLocaleDateString()}
   💰️ Costo: ${event.cost / 100} €
 <a href="https://buonacaccia.net/event.aspx?e=${event.bcId}">🔗 <b>Link</b> dettagli ed iscrizione</a>
 ⏰️ Se vuoi che ti mandi dei promemoria relativi a questo evento scrivimi <u>/promemoria ${event.bcId}</u>
    `
        return msg
    },
    objEventReply: html_mode,

}

module.exports = TEMPLATES
