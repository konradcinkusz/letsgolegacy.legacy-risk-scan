// Every sentence the scan shows a visitor, in Polish, keyed by the codes the parsers and
// the report produce. Keeping the copy here means the classification logic never
// contains display text, and a test can prove every code has a sentence.
//
// House rules for the copy: plain language for a company owner, not a developer; state
// what is known and what is not; no marketing superlatives; never promise that anything
// is rewritten automatically.

import { formatDate, plural } from './format.js';

const fill = (template, params = {}) =>
  template.replace(/\{(\w+)\}/g, (_, key) => (params[key] === undefined || params[key] === null ? '' : String(params[key])));

// ── Errors: input the scan cannot read ──────────────────────────────────────

const XML_REASONS = {
  'unclosed-tag': 'nie zamknięto elementu <{name}>',
  'mismatched-tag': 'znacznik </{found}> nie pasuje do otwartego <{expected}>',
  'unexpected-close': 'nadmiarowy znacznik zamykający </{found}>',
  'bad-attribute': 'niepoprawny atrybut w elemencie <{element}>',
  'bad-tag': 'niepoprawny znacznik',
  'bad-entity': 'nieznana encja {entity}',
  'unterminated-comment': 'niezamknięty komentarz <!-- … -->',
  'unterminated-cdata': 'niezamknięta sekcja CDATA',
  'unterminated-pi': 'niezamknięta instrukcja <? … ?>',
  'text-outside-root': 'tekst poza głównym elementem dokumentu',
  'multiple-roots': 'więcej niż jeden główny element',
  'no-root': 'brak głównego elementu',
  'unexpected-eof': 'plik urywa się w połowie znacznika',
};

export const ERROR_MESSAGES = {
  EMPTY_INPUT: 'Wklej zawartość pliku albo wybierz plik z dysku.',
  INPUT_TOO_LARGE: 'Plik jest za duży (limit to {limitMb} MB). Wklej plik projektu albo listę zależności, a nie całe repozytorium.',
  UNKNOWN_FORMAT:
    'Nie rozpoznano formatu pliku. Obsługiwane są: .csproj (także .vbproj), packages.config, Directory.Packages.props, composer.json, composer.lock i package.json.',
  SOLUTION_FILE: 'To plik rozwiązania (.sln) — zawiera tylko listę projektów. Wklej plik projektu .csproj albo packages.config.',
  XML_MALFORMED: 'Plik wygląda na XML, ale jest uszkodzony: {reason} (wiersz {line}, kolumna {column}). Sprawdź, czy został wklejony w całości.',
  XML_CONFIG_FILE: 'To plik konfiguracyjny (web.config lub app.config), a nie lista zależności. Wklej plik projektu .csproj albo packages.config.',
  XML_UNSUPPORTED_ROOT: 'To poprawny XML, ale nie plik projektu ani packages.config (główny element to <{root}>).',
  JSON_MALFORMED: 'Plik wygląda na JSON, ale zawiera błąd składni{where}. Sprawdź, czy został wklejony w całości.',
  JSON_UNSUPPORTED:
    'To poprawny JSON, ale nie composer.json, composer.lock ani package.json — brakuje sekcji z zależnościami (require, packages albo dependencies).',
  PACKAGE_LOCK_UNSUPPORTED: 'Plik package-lock.json nie jest obsługiwany. Wklej package.json z tego samego projektu.',
  MANIFEST_INVALID: 'Sekcja „{field}” ma nieoczekiwaną strukturę — plik wygląda na uszkodzony.',
  UNEXPECTED: 'Wystąpił nieoczekiwany błąd podczas analizy. Spróbuj ponownie albo wklej inny plik.',
  EOL_DATA_UNAVAILABLE: 'Nie udało się wczytać danych o końcu wsparcia. Odśwież stronę; raport pokaże tymczasem tylko podatności.',
  SAMPLE_UNAVAILABLE: 'Nie udało się wczytać przykładowego pliku. Odśwież stronę i spróbuj ponownie.',
  FILE_READ_FAILED: 'Nie udało się odczytać wybranego pliku.',
};

/** @param {{code: string, params?: object}} error */
export function errorMessage(error) {
  const params = { ...(error.params ?? {}) };
  if (error.code === 'XML_MALFORMED') params.reason = fill(XML_REASONS[params.reason] ?? 'błąd składni', params);
  if (error.code === 'JSON_MALFORMED') params.where = params.line ? ` (wiersz ${params.line}, kolumna ${params.column})` : '';
  return fill(ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.UNEXPECTED, params);
}

// ── What was scanned ────────────────────────────────────────────────────────

export const FORMAT_LABELS = {
  'msbuild-legacy': 'projekt .NET w klasycznym formacie (.csproj sprzed .NET Core)',
  'msbuild-sdk': 'projekt .NET w formacie SDK (.csproj)',
  msbuild: 'plik MSBuild',
  'cpm-props': 'centralne wersje pakietów NuGet (Directory.Packages.props)',
  'packages-config': 'lista pakietów NuGet (packages.config)',
  'composer-json': 'composer.json (PHP)',
  'composer-lock': 'composer.lock (PHP)',
  'package-json': 'package.json (JavaScript)',
};

// ── Report-level hints ──────────────────────────────────────────────────────

const HINTS = {
  HINT_PACKAGES_CONFIG:
    'Projekt korzysta z pliku packages.config. Plik .csproj wymienia tylko pakiety z bibliotekami DLL — skrypty i style (np. Bootstrap) widać wyłącznie w packages.config. Wklej go, aby zobaczyć pełną listę pakietów.',
  HINT_CPM:
    'Pakiety bez wersji w tym pliku: {count}. Zwykle oznacza to centralne zarządzanie wersjami — wklej plik Directory.Packages.props, aby je sprawdzić.',
  HINT_FRAMEWORK_REFERENCES:
    'Pominięto {count} {references} do bibliotek wchodzących w skład .NET Framework (np. System.Web) — ich wsparcie wynika z wersji samego frameworka.',
  HINT_PROJECT_REFERENCES: 'Projekt odwołuje się do {count} {projects} w tym samym rozwiązaniu. Sprawdź także {their} .csproj.',
  HINT_PACKAGES_CONFIG_FRAMEWORK:
    'Wersję .NET Framework odczytano z atrybutu targetFramework w packages.config. To wersja z chwili instalacji pakietów — projekt mógł zostać później przeniesiony na nowszą.',
  HINT_COMPOSER_CONSTRAINTS:
    'composer.json zawiera ograniczenia wersji, a nie wersje faktycznie zainstalowane. Dla każdego pakietu sprawdzono najniższą wersję, na którą pozwala ograniczenie; zainstalowana może być nowsza. Dokładny wynik da composer.lock.',
  HINT_PLATFORM_PACKAGES: 'Pominięto wymagania platformy (rozszerzenia PHP i podobne): {names}.',
  HINT_NPM_RANGES:
    'package.json zawiera zakresy wersji. Dla każdego pakietu sprawdzono najniższą wersję z zakresu; zainstalowana może być nowsza.',
};

export function hintText(hint) {
  const params = { ...(hint.params ?? {}) };
  if (Array.isArray(params.names)) params.names = params.names.join(', ');
  if (typeof params.count === 'number') {
    params.references = plural(params.count, ['referencję', 'referencje', 'referencji']);
    params.projects = plural(params.count, ['innego projektu', 'innych projektów', 'innych projektów']);
    params.their = params.count === 1 ? 'jego plik' : 'ich pliki';
  }
  return fill(HINTS[hint.code] ?? '', params);
}

// ── Row notes ───────────────────────────────────────────────────────────────

const NOTES = {
  EOL_NO_DATA: 'Brak danych o cyklu życia tej wersji w endoflife.date.',
  EOL_OLDER_THAN_CYCLE: 'Tej wersji nie ma w endoflife.date, ale nowsza wersja {cycle} straciła wsparcie {date} — ta tym bardziej nie jest wspierana.',
  EOL_OLDER_THAN_CYCLE_NODATE: 'Tej wersji nie ma w endoflife.date, ale nowsza wersja {cycle} straciła już wsparcie — ta tym bardziej nie jest wspierana.',
  EOL_ESU_UNTIL: 'Płatne rozszerzone aktualizacje bezpieczeństwa (ESU) są dostępne do {date} — tylko jeśli firma je wykupiła.',
  EOL_ESU_ENDED: 'Płatne rozszerzone aktualizacje bezpieczeństwa (ESU) również się zakończyły ({date}).',
  EOL_SECURITY_ONLY: 'Od {date} wydawane są już tylko poprawki bezpieczeństwa.',
  EOL_NO_DATE: 'Producent nie ogłosił daty końca wsparcia.',
  INFRA_SERVICE_PACK: 'Terminy dotyczą ostatniego dodatku Service Pack ({sp}); instalacje ze starszym dodatkiem straciły wsparcie wcześniej.',
  RUNTIME_NETSTANDARD: '.NET Standard to specyfikacja API, a nie środowisko uruchomieniowe — nie ma własnej daty końca wsparcia.',
  RUNTIME_MINIMUM: 'Najniższa wersja dopuszczona przez ograniczenie {spec}. Na serwerze może działać nowsza — warto to sprawdzić.',
  RUNTIME_PLATFORM_OVERRIDE: 'Wersja ustawiona w konfiguracji Composera (config.platform): zależności dobrano tak, jakby aplikacja działała na niej.',
  RUNTIME_UNRESOLVED: 'Framework zdefiniowany przez zmienną MSBuild ({value}), której nie ma w tym pliku.',
  RUNTIME_UNSUPPORTED: 'Nie rozpoznano frameworka „{value}”.',
  VERSION_CPM: 'W pliku brak wersji — przy centralnym zarządzaniu wersjami jest ona w Directory.Packages.props.',
  VERSION_NOT_SPECIFIED: 'W pliku brak wersji tego pakietu.',
  VERSION_FLOATING: 'Wersja pływająca ({spec}) — faktycznie użyta zależy od chwili budowania.',
  VERSION_UNRESOLVED_PROPERTY: 'Wersja zdefiniowana przez zmienną MSBuild ({spec}), której nie ma w tym pliku.',
  VERSION_EXCLUSIVE_LOWER_BOUND: 'Zakres {spec} wyklucza swoją dolną granicę — nie da się wskazać najniższej wersji.',
  VERSION_NO_LOWER_BOUND: 'Ograniczenie „{spec}” nie wyznacza najniższej wersji.',
  VERSION_DEV_BRANCH: 'Wersja rozwojowa ({spec}) — nie da się jej porównać z bazą podatności.',
  VERSION_NON_REGISTRY: 'Pakiet spoza rejestru npm ({spec}) — nie da się go sprawdzić automatycznie.',
  VERSION_DIST_TAG: 'Wersja wskazana etykietą „{spec}”, a nie numerem — zależy od chwili instalacji.',
  VERSION_UNPARSEABLE: 'Nie udało się odczytać wersji „{spec}”.',
  VERSION_PACKAGE_FOLDER_NO_VERSION: 'Nie da się odczytać wersji ze ścieżki {path} (katalog pakietu bez numeru wersji).',
  VERSION_LOWEST: 'Ograniczenie {spec} — sprawdzono najniższą dopuszczalną wersję {version}.',
  SOURCE_MANUAL_DLL:
    'Biblioteka dołączona ręcznie jako plik DLL, poza menedżerem pakietów — nikt jej automatycznie nie aktualizuje. Wymaga ręcznej weryfikacji.',
  SOURCE_GAC: 'Komponent instalowany w systemie (GAC), spoza menedżera pakietów. Wymaga ręcznej weryfikacji.',
  SOURCE_SCRIPT: 'Wykryto po nazwie pliku skryptu; podatności sprawdzono dla pakietu npm o tej nazwie.',
  ALSO_NPM: 'Biblioteka JavaScript — podatności sprawdzono także dla pakietu npm „{name}”, pod którym zwykle są zgłaszane.',
  DEV_DEPENDENCY: 'Zależność używana tylko przy tworzeniu i budowaniu aplikacji.',
  OSV_UNAVAILABLE: 'Podatności nie sprawdzono — brak połączenia z bazą OSV.',
  OSV_DETAILS_MISSING: 'Części opisów nie udało się pobrać; identyfikatory prowadzą do pełnych opisów na osv.dev.',
};

export const NOTE_CODES = Object.keys(NOTES);

export function noteText(note) {
  const params = { ...(note.params ?? {}) };
  if (params.date) params.date = formatDate(params.date);
  return fill(NOTES[note.code] ?? '', params);
}

// ── Statuses, severities and what they mean for a business ─────────────────

export const STATUS_LABELS = {
  eol: 'Koniec wsparcia',
  'eol-soon': 'Koniec wsparcia w ciągu roku',
  vulnerable: 'Znane podatności',
  unknown: 'Nieustalone',
  ok: 'Bez zastrzeżeń',
};

export const SEVERITY_LABELS = { critical: 'krytyczna', high: 'wysoka', moderate: 'średnia', low: 'niska' };

export const ADVISORY_STATE_TEXT = {
  'not-applicable': 'nie dotyczy',
  'not-checked': 'nie sprawdzono',
  'not-checkable': 'nie da się sprawdzić automatycznie',
  'unknown-version': 'nie sprawdzono — nieznana wersja',
  error: 'nie sprawdzono — brak połączenia z OSV',
  none: 'brak znanych',
};

export const SUMMARY_LABELS = {
  eol: 'po końcu wsparcia',
  eolSoon: 'koniec wsparcia w ciągu 12 miesięcy',
  vulnerable: 'ze znanymi podatnościami',
  ok: 'bez zastrzeżeń',
  unknown: 'nieustalone',
};

/** "Co to oznacza dla firmy" — one short paragraph per risk level. */
export const BUSINESS_MEANING = {
  eol: {
    title: 'Po końcu wsparcia',
    text: 'Producent nie wydaje już poprawek, także poprawek bezpieczeństwa. Każda nowo odkryta luka zostaje w systemie na stałe, a zgodność z nowszymi wersjami Windows, przeglądarek czy bazy danych trzeba zapewniać na własny koszt. Aplikacja nie przestanie przez to działać z dnia na dzień, ale ryzyko i koszt utrzymania rosną z każdym miesiącem — i coraz częściej pytają o nie audytorzy, ubezpieczyciele i duzi klienci.',
  },
  'eol-soon': {
    title: 'Koniec wsparcia w ciągu 12 miesięcy',
    text: 'Jest jeszcze czas, żeby zaplanować aktualizację bez pośpiechu: ocenić zakres zmian, przetestować je i wdrożyć w dogodnym terminie. Ta sama praca wykonywana po terminie i pod presją zwykle kosztuje więcej.',
  },
  vulnerable: {
    title: 'Znane podatności',
    text: 'Dla tych wersji opublikowano opisy luk bezpieczeństwa — znają je także atakujący. Nie każdą lukę da się wykorzystać w każdej aplikacji, bo zależy to od sposobu użycia biblioteki, ale każdą trzeba ocenić. Zwykle pomaga aktualizacja do wersji z poprawką; w starszych systemach bywa to trudniejsze, niż się wydaje, bo nowa wersja biblioteki może wymagać nowszego frameworka.',
  },
  unknown: {
    title: 'Nieustalone',
    text: 'Tych pozycji nie dało się ocenić automatycznie: brakuje wersji, wersję wyznacza zakres albo biblioteka została dołączona ręcznie jako plik DLL. Wymagają ręcznej weryfikacji — często to właśnie one są najstarszymi i najrzadziej aktualizowanymi elementami systemu.',
  },
  ok: {
    title: 'Bez zastrzeżeń',
    text: 'Wsparcie trwa, a baza OSV nie zna podatności dla tych wersji. To dobry znak, ale nie gwarancja — raport widzi tylko to, co zapisano w jednym pliku.',
  },
};

/** "Raport wskazuje 3 pozycje wymagające uwagi." */
export function attentionSentence(count) {
  if (count === 0) return 'Raport nie wskazuje pozycji po końcu wsparcia ani ze znanymi podatnościami.';
  const [noun, adjective] = {
    one: ['pozycję', 'wymagającą'],
    few: ['pozycje', 'wymagające'],
    many: ['pozycji', 'wymagających'],
  }[plural(count, ['one', 'few', 'many'])];
  return `Raport wskazuje ${count} ${noun} ${adjective} uwagi.`;
}

// ── Where a row came from ───────────────────────────────────────────────────

const SOURCE_LABELS = {
  TargetFrameworkVersion: 'TargetFrameworkVersion: {value}',
  TargetFramework: 'TargetFramework: {value}',
  TargetFrameworks: 'TargetFrameworks: {value}',
  'packages-config': 'packages.config',
  'package-reference': 'PackageReference',
  'package-reference-update': 'PackageReference (Update)',
  'package-version': 'PackageVersion',
  hintpath: 'HintPath: {value}',
  'manual-dll': 'HintPath: {value}',
  gac: 'Reference (GAC)',
  script: 'plik {value}',
  require: 'require: {value}',
  'require-dev': 'require-dev: {value}',
  'require.php': 'require: php {value}',
  'config.platform.php': 'config.platform.php: {value}',
  lock: 'composer.lock',
  'lock-dev': 'composer.lock (packages-dev)',
  'platform.php': 'composer.lock, platform: php {value}',
  'platform-overrides.php': 'composer.lock, platform-overrides: php {value}',
  dependencies: 'dependencies: {value}',
  devDependencies: 'devDependencies: {value}',
  optionalDependencies: 'optionalDependencies: {value}',
  'engines.node': 'engines.node: {value}',
  form: 'wskazano w formularzu',
};

/** "HintPath: ..\packages\Newtonsoft.Json.6.0.4\lib\net45\Newtonsoft.Json.dll" */
export function sourceText(source) {
  const template = SOURCE_LABELS[source?.origin];
  if (!template) return '';
  let value = source.value;
  // packages.config rows repeat the file name; the spec is already in the version column.
  if (source.origin === 'packages-config') value = '';
  // A NuGet HintPath is long; the packages folder is the part that identifies the package.
  if (source.origin === 'hintpath') value = /packages[\\/][^\\/]+/i.exec(value)?.[0] ?? value;
  return fill(template, { value }).replace(/:\s*$/, '');
}

// ── Page chrome ─────────────────────────────────────────────────────────────

export const UI = {
  statusParsing: 'Analizuję plik…',
  statusOsv: 'Sprawdzam podatności w bazie OSV (zapytania: {count})…',
  statusDone: 'Gotowe. Raport obejmuje {count} {noun}.',
  statusUpdated: 'Raport zaktualizowany o wybrane serwery.',
  statusSample: 'Wczytano przykładowy plik Sklep.Legacy.csproj.',
  statusFile: 'Wczytano plik {name}.',
  metaFormat: 'Plik: {format}.',
  metaEol: 'Dane o końcu wsparcia: endoflife.date, stan na {date}.',
  metaEolMissing: 'Dane o końcu wsparcia: niedostępne.',
  metaOsv: 'Podatności: OSV.dev, sprawdzono {date}.',
  metaOsvSkipped: 'Podatności: w pliku nie było pakietów do sprawdzenia.',
  metaOsvError: 'Podatności: nie sprawdzono (brak połączenia z OSV).',
  summaryTotal: 'Pozycji w raporcie: {count}. Jedna pozycja może należeć do kilku kategorii, np. być po końcu wsparcia i mieć znane podatności.',
  tablePlatform: 'Framework, środowisko uruchomieniowe i serwery',
  tableDependencies: 'Pakiety i biblioteki ({count})',
  emptyPlatform: 'Plik nie określa frameworka ani środowiska uruchomieniowego.',
  emptyDependencies: 'W pliku nie znaleziono pakietów ani bibliotek do sprawdzenia.',
  emptyReport: 'W pliku nie znaleziono frameworka ani zależności do sprawdzenia.',
  columns: { name: 'Nazwa', version: 'Wersja', status: 'Status', eol: 'Koniec wsparcia', advisories: 'Podatności' },
  vulnerableCount: 'Znane podatności: {count}',
  eolEnded: 'zakończone',
  eolNotAnnounced: 'nie ogłoszono',
  eolNoData: 'brak danych',
  eolSource: 'źródło: endoflife.date',
  notApplicable: 'nie dotyczy',
  atLeast: 'co najmniej {version}',
  constraint: 'ograniczenie: {spec}',
  assemblyVersion: 'wersja zestawu: {version}',
  fixedIn: 'Poprawka w wersji: {versions}',
  severity: 'ważność: ',
  newTab: ' (otwiera się w nowej karcie)',
  showMore: 'Pokaż pozostałe ({count})',
};

export const format = fill;
