import type { Lang } from './lang';

/**
 * Словарь переводов. Ключи организованы по разделам (login.*, nav.*, home.*, calltrace.*,
 * recording.*, rtcp.*, sbctelco.*, monitor.*, common.*). Технические имена полей API/CDR
 * (mos_min, jitter, ssrc, saddr и т.п.) не переводятся — это идентификаторы, не текст UI.
 */
export const translations: Record<Lang, Record<string, string>> = {
  ru: {
    // nav
    'nav.logout': 'Выйти',

    // login
    'login.title': 'Вход — CallTracer',
    'login.error': 'Неверный логин или пароль',
    'login.username': 'Логин',
    'login.password': 'Пароль',
    'login.submit': 'Войти',

    // common
    'common.open': 'Открыть',
    'common.loadingTitle': 'Загрузка…',
    'common.loadingHint':
      'Загружаем данные звонка — опрос VoIPmonitor/SBCtelco может занять несколько секунд.',

    // home (дашборд)
    'home.tagline':
      'Трассировка звонков и мониторинг метрик — Convolo (Dialer, S2L), VoIPmonitor, SBCtelco.',
    'home.recording.title': '🎧 Прослушивание звонка',
    'home.recording.description':
      'Найти звонок по Call-ID и прослушать запись: волна + спектрограмма, RTCP-отчёт (MOS, jitter, packet loss), скачивание WAV/OGG/PCAP. Принимает как SIP Call-ID, так и id из дайлера/S2L (например {example}) — резолвится автоматически.',
    'home.recording.placeholder': 'Call-ID (SIP или дайлер/S2L)',
    'home.trace.title': '📋 Трассировка звонка',
    'home.trace.description':
      'Полный разбор звонка по id дайлера ({format}) или S2L: события, найденный CDR VoIPmonitor, SIP-история, SBCtelco (обе ноги, если применимо).',
    'home.trace.placeholder':
      'Call-ID дайлера/S2L (например 1784891602.0026156)',
    'home.monitor.title': '📊 Мониторинг звонков',
    'home.monitor.description':
      'Dialer/S2L: Call Success Rate, звонков и неуспешных в минуту, EMA по слотам, алерты по fail rate, недельные отчёты.',
    'home.monitor.calls': 'Звонки',
    'home.monitor.callsPerMin': 'Звонков/мин',
    'home.monitor.unsuccessPerMin': 'Неуспешных/мин',
    'home.monitor.deviation': 'Отклонения',
    'home.sbctelco.title': '☎️ SBCtelco',
    'home.sbctelco.description':
      'Прямой запрос активных/завершённых звонков SBCtelco ({callTrace}) и поиск в истории ({sbctrace}) по номерам/времени.',
    'home.sbctelco.activeCalls': 'Активные звонки',
    'home.sbctelco.searchHint':
      'Поиск в истории: {url} (нужен хотя бы один параметр фильтра).',
    'home.voipmonitor.title': '🔎 VoIPmonitor CDR',
    'home.voipmonitor.description':
      'Прямой доступ к CDR VoIPmonitor (JSON API). Обязателен параметр {fdatefrom}; опционально {fcaller}, {fcalled}, {fcallid}, {fcallerdType} (точное совпадение по номеру).',
    'home.voipmonitor.todayCalls': 'Звонки за сегодня',

    // calltrace
    'calltrace.title': 'Call Trace',
    'calltrace.callId': 'Call ID:',
    'calltrace.callType': 'Call Type:',
    'calltrace.sipCallId': 'SIP Call ID:',
    'calltrace.format': 'Format:',
    'calltrace.unknown': 'неизвестно',
    'calltrace.events': 'Events',
    'calltrace.log': 'Log',

    // sbctelco
    'sbctelco.savedMessage':
      'Сохранено в БД sbclogs.sbctrace (звонки за последние 2 минуты)',
    'sbctelco.missingFilter':
      'Укажите хотя бы один фильтр: calling, called, timestamp_after или timestamp_before',
    'sbctelco.invalidId': 'Некорректный id',

    // call-recording: форма
    'recording.formTitle': 'Прослушивание звонка (RTP)',
    'recording.formH1': 'Прослушивание звонка по Call-ID',
    'recording.formDescription':
      'Поиск pcap-дампа/аудиозаписи в VoIPmonitor. Можно указать SIP Call-ID (fbasename) или call-trace id из дайлера/S2L (например {example}) — он резолвится автоматически.',
    'recording.callIdLabel': 'Call-ID:',
    'recording.callIdPlaceholder': '1784891602.0026156 или SIP Call-ID',
    'recording.calldateLabel': 'Дата звонка (опц.):',
    'recording.searchSubmit': 'Найти и прослушать',

    // call-recording: ошибки
    'recording.callIdRequired': 'Требуется параметр callid',
    'recording.cdrOrCallidRequired': 'Требуется cdrId или callid',
    'recording.vmSearchError': 'Ошибка поиска звонка в VoIPmonitor',
    'recording.traceNotFoundNotice':
      'Call-ID "{traceId}" похож на внутренний call-trace id, но звонок в VoIPmonitor по нему не найден (см. {link}).',
    'recording.traceParseError':
      'Не удалось распознать "{traceId}" как call-trace id: {error}',

    // call-recording: страница плеера
    'recording.playerTitle': 'Звонок {id}',
    'recording.playerH1': 'Прослушивание звонка',
    'recording.byTraceId': ' (по call-trace id {id})',
    'recording.newSearch': '← новый поиск',
    'recording.callInfoTitle': 'Информация о звонке',
    'recording.field.cdrId': 'ID (cdrId)',
    'recording.field.calldate': 'Дата звонка',
    'recording.field.caller': 'Caller',
    'recording.field.called': 'Called',
    'recording.field.duration': 'Длительность',
    'recording.field.codec': 'Codec (A/B)',
    'recording.field.mosMin': 'MOS min',
    'recording.field.sipResponse': 'SIP response',
    'recording.notFoundNotice':
      'Звонок не найден в CDR VoIPmonitor по этому Call-ID{dateHint}. Аудио и pcap всё равно попробуем получить напрямую по Call-ID.',
    'recording.notFoundDateHint':
      ' (искали без даты — попробуйте указать дату звонка)',
    'recording.searchErrorNotice':
      '⚠️ Не удалось выполнить поиск звонка в VoIPmonitor — сервис временно недоступен или не ответил вовремя. Аудио и pcap всё равно попробуем получить напрямую по Call-ID.',
    'recording.legAgent': 'Звонок агенту',
    'recording.legLead': 'Звонок лиду',
    'recording.viewCallTrace': 'Разбор лога звонка',
    'recording.attemptLabel': 'Попытка {n}',
    'recording.audioSectionTitle': 'RTP-поток (аудио)',
    'recording.audioLoadHint':
      'Волна и спектрограмма строятся в браузере (wavesurfer.js) — загрузка занимает ~10–15 сек.',
    'recording.loadingBtn': '▶ Загрузка…',
    'recording.downloadOgg': 'Скачать OGG',
    'recording.downloadPcap': 'Скачать PCAP',
    'recording.playBtn': '▶ Play',
    'recording.pauseBtn': '⏸ Pause',
    'recording.audioLoadError': 'Ошибка загрузки аудио',
    'recording.rawStreamsTitle': 'RTP-потоки (сырые данные)',
    'recording.showRawFields': 'Показать все поля allrtpstreams',
    'recording.noStreamsData':
      'Нет данных о RTP-потоках (allrtpstreams) для этого звонка.',

    // RTCP-отчёт
    'rtcp.title': 'RTCP-отчёт',
    'rtcp.mosMin': 'MOS (min)',
    'rtcp.jitterAvg': 'Jitter (avg)',
    'rtcp.ms': 'мс',
    'rtcp.packetLoss': 'Packet loss',
    'rtcp.lost': 'потеряно',
    'rtcp.totalPackets': 'Всего RTP-пакетов',
    'rtcp.received': 'получено',
    'rtcp.noData': 'Нет данных для RTCP-отчёта — звонок не найден в CDR.',
    'rtcp.byStreams': 'По потокам (SSRC)',
    'rtcp.col.index': '#',
    'rtcp.col.direction': 'Направление',
    'rtcp.col.ssrc': 'SSRC',
    'rtcp.col.received': 'Пакетов получено',
    'rtcp.col.lost': 'Потеряно',
    'rtcp.col.lossPct': 'Loss %',
    'rtcp.col.jitterMax': 'Jitter max',
    'rtcp.col.duration': 'Длительность',
    'rtcp.sec': 'сек',
    'rtcp.noStreamsForBreakdown':
      'Нет данных о RTP-потоках для разбивки по SSRC.',

    // call-monitor: навигация
    'monitor.nav.calls': 'Звонки',
    'monitor.nav.csr': 'CSR',
    'monitor.nav.callsPerMin': 'Звонков/мин',
    'monitor.nav.unsuccessPerMin': 'Неуспешных/мин',
    'monitor.nav.deviation': 'Отклонения по юзерам',
    'monitor.nav.weeklyReport': 'Отчёт за недели',
    'monitor.nav.weeklyChange': 'Отчёт за 4 нед.',
    'monitor.nav.slotEma': 'Slot EMA',
    'monitor.nav.slotEmaUser': 'Slot EMA (юзер)',
    'monitor.nav.alerts': 'Alerts',

    'monitor.dialer': 'Dialer',
    'monitor.s2l': 'S2L',
    'monitor.none': 'нет',
    'monitor.yes': 'да',
    'monitor.min': 'мин',

    'monitor.slotEma.title': 'Slot EMA',
    'monitor.slotEma.h1': 'EMA по слотам (30 мин)',
    'monitor.currentSlot': 'текущий slot: {slot}',

    'monitor.deviation.title': 'Резюме отклонений по пользователям',
    'monitor.deviation.h1': 'Резюме: отклонение ≥{pct}% по пользователям',
    'monitor.deviation.metaLine':
      'slot {slot}, окно {win} мин · порог {pct} п.п.',
    'monitor.deviation.usersAboveTitle':
      'Пользователи с отклонением ≥{pct} п.п.',
    'monitor.deviation.summaryItem':
      '{user}: +{pct} п.п. (текущий {cur}%, норма {avg}%)',
    'monitor.deviation.noCallsTitle':
      'Без звонков за 5 мин (были за 60 мин, по слоту есть EMA)',
    'monitor.deviation.noCallsDesc':
      'Пользователи, у которых в отчёте за последние 5 мин звонков не было; для них не считаем fail rate, но показываем норму по слоту.',
    'monitor.deviation.noCallsItem':
      '{user} (норма по слоту: {avg} звонков, fail {pct}%)',
    'monitor.deviation.allUsersTitle':
      '{type} (все пользователи за последние {win} мин)',
    'monitor.col.userId': 'userId',
    'monitor.col.calls': 'Звонков',
    'monitor.col.failed': 'Неуспешных',
    'monitor.col.currentFailPct': 'Текущий fail %',
    'monitor.col.slotNorm': 'Норма (слот)',
    'monitor.col.deviationPP': 'Отклонение (п.п.)',

    'monitor.slotEmaUser.title': 'Slot EMA (user)',
    'monitor.slotEmaUser.h1': 'EMA по слотам (userId)',
    'monitor.showBtn': 'Показать',

    'monitor.weeklyChange.title':
      'Отчёт за 4 недели — изменение по пользователям',
    'monitor.weeklyChange.h1':
      'Отчёт за 4 недели: изменение звонков по пользователям',
    'monitor.weeklyChange.metaLine':
      'Недели: {weeks} · порог: разница &gt; {pct}% от последней недели',
    'monitor.weeklyChange.dropTitle':
      'Клиенты с падением ≥{pct}% от последней недели',
    'monitor.weeklyChange.summaryItem':
      '{user}: макс {max}, последняя нед. {week} (−{pct}%)',
    'monitor.weeklyChange.lastWeekSuffix': ' (посл.)',
    'monitor.col.max': 'Макс',
    'monitor.col.lastWeek': 'Посл. нед.',
    'monitor.col.diff': 'Разница',
    'monitor.col.diffPctOfLast': '% от последней',

    'monitor.weeklyReport.title': 'Отчёт за недели',
    'monitor.weeklyReport.h1': 'Отчёт за недели по пользователю',
    'monitor.weeklyReport.desc':
      'Данные накапливаются при каждом запуске крона (звонки за 60 мин приписываются неделе по дате начала)',
    'monitor.weeklyReport.noData': 'Нет данных за недели.',
    'monitor.col.week': 'Неделя (пн)',
    'monitor.col.total': 'Всего',
    'monitor.col.updated': 'Обновлено',

    'monitor.alerts.title': 'Call Monitor Alerts',
    'monitor.alerts.h1': 'Alerts',

    'monitor.calls.title': 'Мониторинг звонков',
    'monitor.calls.h1': 'Мониторинг звонков',
    'monitor.calls.metaLine': 'Dialer и S2L: последние 5 мин',
    'monitor.calls.dialerStatsTitle': 'Dialer (статистика)',
    'monitor.calls.s2lCallsTitle': 'S2L (звонки)',

    'monitor.csr.title': 'CSR — Call Success Rate',
    'monitor.csr.h1': 'Call Success Rate (CSR)',
    'monitor.csr.metaLine': 'Скользящие окна 5 / 15 / 60 мин · по callStatus',
    'monitor.col.window': 'Окно',
    'monitor.col.successful': 'Успешных',
    'monitor.col.failedPct': 'Неуспешных %',
    'monitor.col.byStatus': 'По статусам',

    'monitor.callsPerMin.title': 'Звонков в минуту — среднее и отклонение',
    'monitor.callsPerMin.h1': 'Звонков в минуту (по типу)',
    'monitor.callsPerMin.metaLine':
      '{slotInfo} · среднее (история по крону для этого слота) и текущий rate за окно 5 мин; отклонение = текущий − среднее (отрицательное — звонков меньше, положительное — больше)',
    'monitor.col.type': 'Тип',
    'monitor.col.avgHistory': 'Среднее (история)',
    'monitor.col.currentRate': 'Текущий (звонков/мин)',
    'monitor.col.deviation': 'Отклонение',
    'monitor.col.measurements': 'Измерений (n)',
    'monitor.col.currentWindow': 'Текущее за окно',
    'monitor.forMinutes': '{n} за {win} мин',
    'monitor.slotFallback': 'slot —',

    'monitor.unsuccessPerMin.title': 'Неуспешных в минуту',
    'monitor.unsuccessPerMin.h1': 'Неуспешных звонков в минуту',
    'monitor.unsuccessPerMin.metaLine':
      '{slotInfo} · среднее и отклонение по окнам 5/15/60 для этого слота; при отсутствии сохранённой истории среднее и «текущее за окно» считаются по данным API (отклонение = 0)',
    'monitor.refreshFromApi': 'Обновить из API',
    'monitor.windowMinutes': 'Окно {w} мин',
    'monitor.col.avgFailedPerMin': 'Среднее (неуспешных/мин)',
    'monitor.typeAll': 'Все неуспешные',
    'monitor.typeOutgoingMissed': 'Outgoing missed',
    'monitor.typeNoAnswer': 'No answer',
    'monitor.typeFailed': 'Failed',
  },
  en: {
    'nav.logout': 'Logout',

    'login.title': 'Sign in — CallTracer',
    'login.error': 'Invalid username or password',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',

    // common
    'common.open': 'Open',
    'common.loadingTitle': 'Loading…',
    'common.loadingHint':
      'Fetching call data — querying VoIPmonitor/SBCtelco can take a few seconds.',

    // home (dashboard)
    'home.tagline':
      'Call tracing and metrics monitoring — Convolo (Dialer, S2L), VoIPmonitor, SBCtelco.',
    'home.recording.title': '🎧 Call recording',
    'home.recording.description':
      'Find a call by Call-ID and listen to the recording: waveform + spectrogram, RTCP report (MOS, jitter, packet loss), WAV/OGG/PCAP download. Accepts both a SIP Call-ID and a dialer/S2L id (e.g. {example}) — resolved automatically.',
    'home.recording.placeholder': 'Call-ID (SIP or dialer/S2L)',
    'home.trace.title': '📋 Call trace',
    'home.trace.description':
      'Full call breakdown by dialer id ({format}) or S2L: events, matched VoIPmonitor CDR, SIP history, SBCtelco (both legs, when applicable).',
    'home.trace.placeholder': 'Dialer/S2L Call-ID (e.g. 1784891602.0026156)',
    'home.monitor.title': '📊 Call monitoring',
    'home.monitor.description':
      'Dialer/S2L: Call Success Rate, calls and failures per minute, slot EMA, fail-rate alerts, weekly reports.',
    'home.monitor.calls': 'Calls',
    'home.monitor.callsPerMin': 'Calls/min',
    'home.monitor.unsuccessPerMin': 'Failed/min',
    'home.monitor.deviation': 'Deviations',
    'home.sbctelco.title': '☎️ SBCtelco',
    'home.sbctelco.description':
      'Direct query of active/completed SBCtelco calls ({callTrace}) and history search ({sbctrace}) by number/time.',
    'home.sbctelco.activeCalls': 'Active calls',
    'home.sbctelco.searchHint':
      'History search: {url} (at least one filter parameter required).',
    'home.voipmonitor.title': '🔎 VoIPmonitor CDR',
    'home.voipmonitor.description':
      'Direct access to VoIPmonitor CDR (JSON API). {fdatefrom} is required; optionally {fcaller}, {fcalled}, {fcallid}, {fcallerdType} (exact number match).',
    'home.voipmonitor.todayCalls': "Today's calls",

    // calltrace
    'calltrace.title': 'Call Trace',
    'calltrace.callId': 'Call ID:',
    'calltrace.callType': 'Call Type:',
    'calltrace.sipCallId': 'SIP Call ID:',
    'calltrace.format': 'Format:',
    'calltrace.unknown': 'unknown',
    'calltrace.events': 'Events',
    'calltrace.log': 'Log',

    // sbctelco
    'sbctelco.savedMessage':
      'Saved to sbclogs.sbctrace DB (calls from the last 2 minutes)',
    'sbctelco.missingFilter':
      'Provide at least one filter: calling, called, timestamp_after or timestamp_before',
    'sbctelco.invalidId': 'Invalid id',

    // call-recording: form
    'recording.formTitle': 'Call recording (RTP)',
    'recording.formH1': 'Listen to a call by Call-ID',
    'recording.formDescription':
      'Search for a pcap dump/recording in VoIPmonitor. You can enter a SIP Call-ID (fbasename) or a dialer/S2L call-trace id (e.g. {example}) — it is resolved automatically.',
    'recording.callIdLabel': 'Call-ID:',
    'recording.callIdPlaceholder': '1784891602.0026156 or SIP Call-ID',
    'recording.calldateLabel': 'Call date (optional):',
    'recording.searchSubmit': 'Find and listen',

    // call-recording: errors
    'recording.callIdRequired': 'Query param callid is required',
    'recording.cdrOrCallidRequired': 'cdrId or callid is required',
    'recording.vmSearchError': 'Error searching for the call in VoIPmonitor',
    'recording.traceNotFoundNotice':
      'Call-ID "{traceId}" looks like an internal call-trace id, but the call was not found in VoIPmonitor (see {link}).',
    'recording.traceParseError':
      'Could not resolve "{traceId}" as a call-trace id: {error}',

    // call-recording: player page
    'recording.playerTitle': 'Call {id}',
    'recording.playerH1': 'Listening to the call',
    'recording.byTraceId': ' (via call-trace id {id})',
    'recording.newSearch': '← new search',
    'recording.callInfoTitle': 'Call information',
    'recording.field.cdrId': 'ID (cdrId)',
    'recording.field.calldate': 'Call date',
    'recording.field.caller': 'Caller',
    'recording.field.called': 'Called',
    'recording.field.duration': 'Duration',
    'recording.field.codec': 'Codec (A/B)',
    'recording.field.mosMin': 'MOS min',
    'recording.field.sipResponse': 'SIP response',
    'recording.notFoundNotice':
      'The call was not found in the VoIPmonitor CDR by this Call-ID{dateHint}. We will still try to fetch audio and pcap directly by Call-ID.',
    'recording.notFoundDateHint':
      ' (searched without a date — try specifying the call date)',
    'recording.searchErrorNotice':
      '⚠️ Failed to search for the call in VoIPmonitor — the service is temporarily unavailable or did not respond in time. We will still try to fetch audio and pcap directly by Call-ID.',
    'recording.legAgent': 'Call to agent',
    'recording.legLead': 'Call to lead',
    'recording.viewCallTrace': 'View call log analysis',
    'recording.attemptLabel': 'Attempt {n}',
    'recording.audioSectionTitle': 'RTP stream (audio)',
    'recording.audioLoadHint':
      'The waveform and spectrogram are rendered in the browser (wavesurfer.js) — loading takes ~10–15 sec.',
    'recording.loadingBtn': '▶ Loading…',
    'recording.downloadOgg': 'Download OGG',
    'recording.downloadPcap': 'Download PCAP',
    'recording.playBtn': '▶ Play',
    'recording.pauseBtn': '⏸ Pause',
    'recording.audioLoadError': 'Failed to load audio',
    'recording.rawStreamsTitle': 'RTP streams (raw data)',
    'recording.showRawFields': 'Show all allrtpstreams fields',
    'recording.noStreamsData':
      'No RTP stream data (allrtpstreams) for this call.',

    // RTCP report
    'rtcp.title': 'RTCP report',
    'rtcp.mosMin': 'MOS (min)',
    'rtcp.jitterAvg': 'Jitter (avg)',
    'rtcp.ms': 'ms',
    'rtcp.packetLoss': 'Packet loss',
    'rtcp.lost': 'lost',
    'rtcp.totalPackets': 'Total RTP packets',
    'rtcp.received': 'received',
    'rtcp.noData':
      'No data for the RTCP report — the call was not found in the CDR.',
    'rtcp.byStreams': 'By stream (SSRC)',
    'rtcp.col.index': '#',
    'rtcp.col.direction': 'Direction',
    'rtcp.col.ssrc': 'SSRC',
    'rtcp.col.received': 'Packets received',
    'rtcp.col.lost': 'Lost',
    'rtcp.col.lossPct': 'Loss %',
    'rtcp.col.jitterMax': 'Jitter max',
    'rtcp.col.duration': 'Duration',
    'rtcp.sec': 'sec',
    'rtcp.noStreamsForBreakdown': 'No RTP stream data for the SSRC breakdown.',

    // call-monitor: navigation
    'monitor.nav.calls': 'Calls',
    'monitor.nav.csr': 'CSR',
    'monitor.nav.callsPerMin': 'Calls/min',
    'monitor.nav.unsuccessPerMin': 'Failed/min',
    'monitor.nav.deviation': 'User deviations',
    'monitor.nav.weeklyReport': 'Weekly report',
    'monitor.nav.weeklyChange': '4-week report',
    'monitor.nav.slotEma': 'Slot EMA',
    'monitor.nav.slotEmaUser': 'Slot EMA (user)',
    'monitor.nav.alerts': 'Alerts',

    'monitor.dialer': 'Dialer',
    'monitor.s2l': 'S2L',
    'monitor.none': 'none',
    'monitor.yes': 'yes',
    'monitor.min': 'min',

    'monitor.slotEma.title': 'Slot EMA',
    'monitor.slotEma.h1': 'Slot EMA (30 min)',
    'monitor.currentSlot': 'current slot: {slot}',

    'monitor.deviation.title': 'User deviation summary',
    'monitor.deviation.h1': 'Summary: deviation ≥{pct}% by user',
    'monitor.deviation.metaLine':
      'slot {slot}, window {win} min · threshold {pct} pp',
    'monitor.deviation.usersAboveTitle': 'Users with deviation ≥{pct} pp',
    'monitor.deviation.summaryItem':
      '{user}: +{pct} pp (current {cur}%, norm {avg}%)',
    'monitor.deviation.noCallsTitle':
      'No calls in 5 min (had calls in 60 min, slot has EMA)',
    'monitor.deviation.noCallsDesc':
      "Users who had no calls in the last-5-min report; we don't compute a fail rate for them, but show the slot norm.",
    'monitor.deviation.noCallsItem':
      '{user} (slot norm: {avg} calls, fail {pct}%)',
    'monitor.deviation.allUsersTitle':
      '{type} (all users over the last {win} min)',
    'monitor.col.userId': 'userId',
    'monitor.col.calls': 'Calls',
    'monitor.col.failed': 'Failed',
    'monitor.col.currentFailPct': 'Current fail %',
    'monitor.col.slotNorm': 'Norm (slot)',
    'monitor.col.deviationPP': 'Deviation (pp)',

    'monitor.slotEmaUser.title': 'Slot EMA (user)',
    'monitor.slotEmaUser.h1': 'Slot EMA (userId)',
    'monitor.showBtn': 'Show',

    'monitor.weeklyChange.title': '4-week report — change by user',
    'monitor.weeklyChange.h1': '4-week report: change in calls by user',
    'monitor.weeklyChange.metaLine':
      'Weeks: {weeks} · threshold: difference &gt; {pct}% of the last week',
    'monitor.weeklyChange.dropTitle':
      'Customers with a drop of ≥{pct}% vs the last week',
    'monitor.weeklyChange.summaryItem':
      '{user}: max {max}, last week {week} (−{pct}%)',
    'monitor.weeklyChange.lastWeekSuffix': ' (last)',
    'monitor.col.max': 'Max',
    'monitor.col.lastWeek': 'Last week',
    'monitor.col.diff': 'Diff',
    'monitor.col.diffPctOfLast': '% of last week',

    'monitor.weeklyReport.title': 'Weekly report',
    'monitor.weeklyReport.h1': 'Weekly report by user',
    'monitor.weeklyReport.desc':
      'Data accumulates on every cron run (calls in the last 60 min are attributed to the week by its start date)',
    'monitor.weeklyReport.noData': 'No weekly data.',
    'monitor.col.week': 'Week (Mon)',
    'monitor.col.total': 'Total',
    'monitor.col.updated': 'Updated',

    'monitor.alerts.title': 'Call Monitor Alerts',
    'monitor.alerts.h1': 'Alerts',

    'monitor.calls.title': 'Call monitoring',
    'monitor.calls.h1': 'Call monitoring',
    'monitor.calls.metaLine': 'Dialer and S2L: last 5 min',
    'monitor.calls.dialerStatsTitle': 'Dialer (stats)',
    'monitor.calls.s2lCallsTitle': 'S2L (calls)',

    'monitor.csr.title': 'CSR — Call Success Rate',
    'monitor.csr.h1': 'Call Success Rate (CSR)',
    'monitor.csr.metaLine': 'Rolling windows 5 / 15 / 60 min · by callStatus',
    'monitor.col.window': 'Window',
    'monitor.col.successful': 'Successful',
    'monitor.col.failedPct': 'Failed %',
    'monitor.col.byStatus': 'By status',

    'monitor.callsPerMin.title': 'Calls per minute — average and deviation',
    'monitor.callsPerMin.h1': 'Calls per minute (by type)',
    'monitor.callsPerMin.metaLine':
      '{slotInfo} · average (cron history for this slot) and current rate over a 5-min window; deviation = current − average (negative — fewer calls, positive — more)',
    'monitor.col.type': 'Type',
    'monitor.col.avgHistory': 'Average (history)',
    'monitor.col.currentRate': 'Current (calls/min)',
    'monitor.col.deviation': 'Deviation',
    'monitor.col.measurements': 'Measurements (n)',
    'monitor.col.currentWindow': 'Current window',
    'monitor.forMinutes': '{n} over {win} min',
    'monitor.slotFallback': 'slot —',

    'monitor.unsuccessPerMin.title': 'Failed calls per minute',
    'monitor.unsuccessPerMin.h1': 'Failed calls per minute',
    'monitor.unsuccessPerMin.metaLine':
      '{slotInfo} · average and deviation over windows 5/15/60 for this slot; without saved history, the average and "current window" are computed from the API data (deviation = 0)',
    'monitor.refreshFromApi': 'Refresh from API',
    'monitor.windowMinutes': 'Window {w} min',
    'monitor.col.avgFailedPerMin': 'Average (failed/min)',
    'monitor.typeAll': 'All failed',
    'monitor.typeOutgoingMissed': 'Outgoing missed',
    'monitor.typeNoAnswer': 'No answer',
    'monitor.typeFailed': 'Failed',
  },
  ar: {
    'nav.logout': 'تسجيل الخروج',

    'login.title': 'تسجيل الدخول — CallTracer',
    'login.error': 'اسم المستخدم أو كلمة المرور غير صحيحة',
    'login.username': 'اسم المستخدم',
    'login.password': 'كلمة المرور',
    'login.submit': 'تسجيل الدخول',

    // common
    'common.open': 'فتح',
    'common.loadingTitle': 'جارٍ التحميل…',
    'common.loadingHint':
      'جارٍ جلب بيانات المكالمة — قد يستغرق الاستعلام عن VoIPmonitor/SBCtelco بضع ثوانٍ.',

    // home (لوحة التحكم)
    'home.tagline':
      'تتبع المكالمات ومراقبة المقاييس — Convolo (Dialer, S2L)، VoIPmonitor، SBCtelco.',
    'home.recording.title': '🎧 الاستماع إلى المكالمة',
    'home.recording.description':
      'ابحث عن مكالمة عبر Call-ID واستمع إلى التسجيل: الموجة الصوتية + الطيف الترددي، تقرير RTCP (MOS، jitter، فقدان الحزم)، تنزيل WAV/OGG/PCAP. يقبل SIP Call-ID أو معرّف dialer/S2L (مثال {example}) — يتم التعرّف عليه تلقائياً.',
    'home.recording.placeholder': 'Call-ID (SIP أو dialer/S2L)',
    'home.trace.title': '📋 تتبع المكالمة',
    'home.trace.description':
      'تحليل كامل للمكالمة عبر معرّف dialer ({format}) أو S2L: الأحداث، سجل CDR الموجود في VoIPmonitor، سجل SIP، SBCtelco (كلا الطرفين إن أمكن).',
    'home.trace.placeholder': 'معرّف dialer/S2L (مثال 1784891602.0026156)',
    'home.monitor.title': '📊 مراقبة المكالمات',
    'home.monitor.description':
      'Dialer/S2L: معدل نجاح المكالمات (CSR)، عدد المكالمات والفاشلة في الدقيقة، EMA حسب الفترات الزمنية، تنبيهات معدل الفشل، تقارير أسبوعية.',
    'home.monitor.calls': 'المكالمات',
    'home.monitor.callsPerMin': 'مكالمات/دقيقة',
    'home.monitor.unsuccessPerMin': 'فاشلة/دقيقة',
    'home.monitor.deviation': 'الانحرافات',
    'home.sbctelco.title': '☎️ SBCtelco',
    'home.sbctelco.description':
      'استعلام مباشر عن مكالمات SBCtelco النشطة/المكتملة ({callTrace}) والبحث في السجل ({sbctrace}) حسب الرقم/الوقت.',
    'home.sbctelco.activeCalls': 'المكالمات النشطة',
    'home.sbctelco.searchHint':
      'البحث في السجل: {url} (يلزم توفر معامل تصفية واحد على الأقل).',
    'home.voipmonitor.title': '🔎 سجلات VoIPmonitor CDR',
    'home.voipmonitor.description':
      'وصول مباشر إلى سجلات VoIPmonitor CDR (JSON API). المعامل {fdatefrom} مطلوب؛ اختيارياً {fcaller}، {fcalled}، {fcallid}، {fcallerdType} (تطابق دقيق للرقم).',
    'home.voipmonitor.todayCalls': 'مكالمات اليوم',

    // calltrace
    'calltrace.title': 'تتبع المكالمة',
    'calltrace.callId': 'معرّف المكالمة:',
    'calltrace.callType': 'نوع المكالمة:',
    'calltrace.sipCallId': 'SIP Call ID:',
    'calltrace.format': 'الصيغة:',
    'calltrace.unknown': 'غير معروف',
    'calltrace.events': 'الأحداث',
    'calltrace.log': 'السجل',

    // sbctelco
    'sbctelco.savedMessage':
      'تم الحفظ في قاعدة بيانات sbclogs.sbctrace (مكالمات آخر دقيقتين)',
    'sbctelco.missingFilter':
      'يرجى تحديد فلتر واحد على الأقل: calling أو called أو timestamp_after أو timestamp_before',
    'sbctelco.invalidId': 'معرّف غير صالح',

    // call-recording: النموذج
    'recording.formTitle': 'الاستماع إلى المكالمة (RTP)',
    'recording.formH1': 'الاستماع إلى المكالمة عبر Call-ID',
    'recording.formDescription':
      'البحث عن ملف pcap/تسجيل صوتي في VoIPmonitor. يمكن إدخال SIP Call-ID (fbasename) أو معرّف dialer/S2L (مثال {example}) — يتم التعرّف عليه تلقائياً.',
    'recording.callIdLabel': 'Call-ID:',
    'recording.callIdPlaceholder': '1784891602.0026156 أو SIP Call-ID',
    'recording.calldateLabel': 'تاريخ المكالمة (اختياري):',
    'recording.searchSubmit': 'بحث واستماع',

    // call-recording: الأخطاء
    'recording.callIdRequired': 'المعامل callid مطلوب',
    'recording.cdrOrCallidRequired': 'مطلوب cdrId أو callid',
    'recording.vmSearchError': 'خطأ أثناء البحث عن المكالمة في VoIPmonitor',
    'recording.traceNotFoundNotice':
      'يبدو أن Call-ID "{traceId}" هو معرّف داخلي (call-trace)، لكن لم يتم العثور على المكالمة في VoIPmonitor (راجع {link}).',
    'recording.traceParseError':
      'تعذّر التعرّف على "{traceId}" كمعرّف call-trace: {error}',

    // call-recording: صفحة المشغّل
    'recording.playerTitle': 'المكالمة {id}',
    'recording.playerH1': 'الاستماع إلى المكالمة',
    'recording.byTraceId': ' (عبر معرّف call-trace {id})',
    'recording.newSearch': '← بحث جديد',
    'recording.callInfoTitle': 'معلومات المكالمة',
    'recording.field.cdrId': 'ID (cdrId)',
    'recording.field.calldate': 'تاريخ المكالمة',
    'recording.field.caller': 'Caller',
    'recording.field.called': 'Called',
    'recording.field.duration': 'المدة',
    'recording.field.codec': 'Codec (A/B)',
    'recording.field.mosMin': 'MOS min',
    'recording.field.sipResponse': 'SIP response',
    'recording.notFoundNotice':
      'لم يتم العثور على المكالمة في CDR الخاص بـ VoIPmonitor عبر Call-ID هذا{dateHint}. سنحاول مع ذلك جلب الصوت وملف pcap مباشرة عبر Call-ID.',
    'recording.notFoundDateHint':
      ' (تم البحث بدون تاريخ — جرّب تحديد تاريخ المكالمة)',
    'recording.searchErrorNotice':
      '⚠️ تعذّر البحث عن المكالمة في VoIPmonitor — الخدمة غير متاحة مؤقتاً أو لم تستجب في الوقت المحدد. سنحاول مع ذلك جلب الصوت وملف pcap مباشرة عبر Call-ID.',
    'recording.legAgent': 'الاتصال بالوكيل',
    'recording.legLead': 'الاتصال بالعميل المحتمل',
    'recording.viewCallTrace': 'عرض تحليل سجل المكالمة',
    'recording.attemptLabel': 'المحاولة {n}',
    'recording.audioSectionTitle': 'تدفق RTP (الصوت)',
    'recording.audioLoadHint':
      'يتم رسم الموجة الصوتية والطيف الترددي في المتصفح (wavesurfer.js) — يستغرق التحميل ~10–15 ثانية.',
    'recording.loadingBtn': '▶ جارٍ التحميل…',
    'recording.downloadOgg': 'تنزيل OGG',
    'recording.downloadPcap': 'تنزيل PCAP',
    'recording.playBtn': '▶ تشغيل',
    'recording.pauseBtn': '⏸ إيقاف مؤقت',
    'recording.audioLoadError': 'فشل تحميل الصوت',
    'recording.rawStreamsTitle': 'تدفقات RTP (بيانات خام)',
    'recording.showRawFields': 'إظهار جميع حقول allrtpstreams',
    'recording.noStreamsData':
      'لا توجد بيانات عن تدفقات RTP (allrtpstreams) لهذه المكالمة.',

    // تقرير RTCP
    'rtcp.title': 'تقرير RTCP',
    'rtcp.mosMin': 'MOS (min)',
    'rtcp.jitterAvg': 'Jitter (avg)',
    'rtcp.ms': 'مللي ثانية',
    'rtcp.packetLoss': 'فقدان الحزم',
    'rtcp.lost': 'مفقودة',
    'rtcp.totalPackets': 'إجمالي حزم RTP',
    'rtcp.received': 'مستلمة',
    'rtcp.noData':
      'لا توجد بيانات لتقرير RTCP — لم يتم العثور على المكالمة في CDR.',
    'rtcp.byStreams': 'حسب التدفق (SSRC)',
    'rtcp.col.index': '#',
    'rtcp.col.direction': 'الاتجاه',
    'rtcp.col.ssrc': 'SSRC',
    'rtcp.col.received': 'الحزم المستلمة',
    'rtcp.col.lost': 'المفقودة',
    'rtcp.col.lossPct': 'Loss %',
    'rtcp.col.jitterMax': 'Jitter max',
    'rtcp.col.duration': 'المدة',
    'rtcp.sec': 'ثانية',
    'rtcp.noStreamsForBreakdown': 'لا توجد بيانات عن تدفقات RTP لتفصيل SSRC.',

    // call-monitor: التنقل
    'monitor.nav.calls': 'المكالمات',
    'monitor.nav.csr': 'CSR',
    'monitor.nav.callsPerMin': 'مكالمات/دقيقة',
    'monitor.nav.unsuccessPerMin': 'فاشلة/دقيقة',
    'monitor.nav.deviation': 'انحرافات المستخدمين',
    'monitor.nav.weeklyReport': 'تقرير الأسابيع',
    'monitor.nav.weeklyChange': 'تقرير 4 أسابيع',
    'monitor.nav.slotEma': 'Slot EMA',
    'monitor.nav.slotEmaUser': 'Slot EMA (مستخدم)',
    'monitor.nav.alerts': 'التنبيهات',

    'monitor.dialer': 'Dialer',
    'monitor.s2l': 'S2L',
    'monitor.none': 'لا يوجد',
    'monitor.yes': 'نعم',
    'monitor.min': 'دقيقة',

    'monitor.slotEma.title': 'Slot EMA',
    'monitor.slotEma.h1': 'EMA حسب الفترات الزمنية (30 دقيقة)',
    'monitor.currentSlot': 'الفترة الحالية: {slot}',

    'monitor.deviation.title': 'ملخص انحرافات المستخدمين',
    'monitor.deviation.h1': 'ملخص: انحراف ≥{pct}% حسب المستخدم',
    'monitor.deviation.metaLine':
      'الفترة {slot}، النافذة {win} دقيقة · الحد {pct} نقطة مئوية',
    'monitor.deviation.usersAboveTitle': 'مستخدمون بانحراف ≥{pct} نقطة مئوية',
    'monitor.deviation.summaryItem':
      '{user}: +{pct} نقطة مئوية (الحالي {cur}%، المعدل {avg}%)',
    'monitor.deviation.noCallsTitle':
      'بدون مكالمات خلال 5 دقائق (كانت هناك خلال 60 دقيقة، والفترة لديها EMA)',
    'monitor.deviation.noCallsDesc':
      'مستخدمون لم يكن لديهم مكالمات في تقرير آخر 5 دقائق؛ لا نحسب لهم معدل الفشل، لكن نعرض معدل الفترة.',
    'monitor.deviation.noCallsItem':
      '{user} (معدل الفترة: {avg} مكالمة، فشل {pct}%)',
    'monitor.deviation.allUsersTitle':
      '{type} (جميع المستخدمين خلال آخر {win} دقيقة)',
    'monitor.col.userId': 'userId',
    'monitor.col.calls': 'المكالمات',
    'monitor.col.failed': 'الفاشلة',
    'monitor.col.currentFailPct': 'نسبة الفشل الحالية %',
    'monitor.col.slotNorm': 'المعدل (الفترة)',
    'monitor.col.deviationPP': 'الانحراف (نقطة مئوية)',

    'monitor.slotEmaUser.title': 'Slot EMA (مستخدم)',
    'monitor.slotEmaUser.h1': 'EMA حسب الفترات (userId)',
    'monitor.showBtn': 'عرض',

    'monitor.weeklyChange.title': 'تقرير 4 أسابيع — التغيّر حسب المستخدم',
    'monitor.weeklyChange.h1':
      'تقرير 4 أسابيع: تغيّر عدد المكالمات حسب المستخدم',
    'monitor.weeklyChange.metaLine':
      'الأسابيع: {weeks} · الحد: فرق &gt; {pct}% عن الأسبوع الأخير',
    'monitor.weeklyChange.dropTitle': 'عملاء بانخفاض ≥{pct}% عن الأسبوع الأخير',
    'monitor.weeklyChange.summaryItem':
      '{user}: الحد الأقصى {max}، الأسبوع الأخير {week} (−{pct}%)',
    'monitor.weeklyChange.lastWeekSuffix': ' (الأخير)',
    'monitor.col.max': 'الحد الأقصى',
    'monitor.col.lastWeek': 'الأسبوع الأخير',
    'monitor.col.diff': 'الفرق',
    'monitor.col.diffPctOfLast': '% من الأسبوع الأخير',

    'monitor.weeklyReport.title': 'تقرير الأسابيع',
    'monitor.weeklyReport.h1': 'تقرير الأسابيع حسب المستخدم',
    'monitor.weeklyReport.desc':
      'تتراكم البيانات مع كل تشغيل للـ cron (تُنسب مكالمات آخر 60 دقيقة إلى الأسبوع حسب تاريخ بدايته)',
    'monitor.weeklyReport.noData': 'لا توجد بيانات أسبوعية.',
    'monitor.col.week': 'الأسبوع (الاثنين)',
    'monitor.col.total': 'الإجمالي',
    'monitor.col.updated': 'آخر تحديث',

    'monitor.alerts.title': 'Call Monitor Alerts',
    'monitor.alerts.h1': 'التنبيهات',

    'monitor.calls.title': 'مراقبة المكالمات',
    'monitor.calls.h1': 'مراقبة المكالمات',
    'monitor.calls.metaLine': 'Dialer و S2L: آخر 5 دقائق',
    'monitor.calls.dialerStatsTitle': 'Dialer (إحصائيات)',
    'monitor.calls.s2lCallsTitle': 'S2L (مكالمات)',

    'monitor.csr.title': 'CSR — معدل نجاح المكالمات',
    'monitor.csr.h1': 'معدل نجاح المكالمات (CSR)',
    'monitor.csr.metaLine': 'نوافذ متحركة 5 / 15 / 60 دقيقة · حسب callStatus',
    'monitor.col.window': 'النافذة',
    'monitor.col.successful': 'الناجحة',
    'monitor.col.failedPct': 'الفاشلة %',
    'monitor.col.byStatus': 'حسب الحالة',

    'monitor.callsPerMin.title': 'مكالمات في الدقيقة — المعدل والانحراف',
    'monitor.callsPerMin.h1': 'مكالمات في الدقيقة (حسب النوع)',
    'monitor.callsPerMin.metaLine':
      '{slotInfo} · المعدل (سجل cron لهذه الفترة) والمعدل الحالي خلال نافذة 5 دقائق؛ الانحراف = الحالي − المعدل (سالب — مكالمات أقل، موجب — أكثر)',
    'monitor.col.type': 'النوع',
    'monitor.col.avgHistory': 'المعدل (السجل)',
    'monitor.col.currentRate': 'الحالي (مكالمات/دقيقة)',
    'monitor.col.deviation': 'الانحراف',
    'monitor.col.measurements': 'القياسات (n)',
    'monitor.col.currentWindow': 'النافذة الحالية',
    'monitor.forMinutes': '{n} خلال {win} دقيقة',
    'monitor.slotFallback': 'slot —',

    'monitor.unsuccessPerMin.title': 'المكالمات الفاشلة في الدقيقة',
    'monitor.unsuccessPerMin.h1': 'المكالمات الفاشلة في الدقيقة',
    'monitor.unsuccessPerMin.metaLine':
      '{slotInfo} · المعدل والانحراف حسب نوافذ 5/15/60 لهذه الفترة؛ عند عدم وجود سجل محفوظ يُحسب المعدل و"النافذة الحالية" من بيانات API (الانحراف = 0)',
    'monitor.refreshFromApi': 'تحديث من API',
    'monitor.windowMinutes': 'نافذة {w} دقيقة',
    'monitor.col.avgFailedPerMin': 'المعدل (فاشلة/دقيقة)',
    'monitor.typeAll': 'كل الفاشلة',
    'monitor.typeOutgoingMissed': 'Outgoing missed',
    'monitor.typeNoAnswer': 'No answer',
    'monitor.typeFailed': 'Failed',
  },
};
