((root) => {
  'use strict';
  const KEY = 'dzienny.v1';
  const FUTURE = 'Twoje dane zostały zapisane przez nowszą wersję Pulnory. Ta wersja aplikacji nie może ich bezpiecznie otworzyć ani zmienić. Zaktualizuj aplikację. Twoje dane nie zostały usunięte.';
  const DAMAGED = 'Nie można bezpiecznie odczytać zapisanych danych Pulnory. Zapis pozostaje nietknięty. Nie usuwaj danych witryny; zachowaj kopię i skontaktuj się z pomocą.';
  const CONFLICT = 'Dane zostały zmienione w innej karcie lub kontekście aplikacji. Zapis został zablokowany. Otwórz aplikację ponownie, aby odczytać aktualne dane.';

  function create(getStorage, onProtected = () => {}) {
    let baseline;
    let lastState;
    let loaded = false;
    let reason = '';
    function protect(message) {
      reason = reason || message;
      onProtected(reason);
      throw new Error(reason);
    }
    function inspect(raw) {
      let source;
      try { source = JSON.parse(raw); } catch { return protect(DAMAGED); }
      if (!source || typeof source !== 'object' || Array.isArray(source)) return protect(DAMAGED);
      if (typeof source.schemaVersion === 'number' && source.schemaVersion > 6) return protect(FUTURE);
      try { root.SpendoBackup.validate(source, { localState: true }); } catch { return protect(DAMAGED); }
      return source;
    }
    function read() {
      try { return getStorage().getItem(KEY); }
      catch { return protect('Nie można odczytać pamięci urządzenia. Aplikacja zablokowała zapis, aby chronić Twoje dane. Spróbuj otworzyć ją ponownie.'); }
    }
    function check() {
      if (reason) throw new Error(reason);
      if (!loaded) return protect(DAMAGED);
      const current = read();
      if (current !== null) inspect(current);
      if (current !== baseline) return protect(CONFLICT);
      return current;
    }
    function load() {
      if (reason) throw new Error(reason);
      if (loaded) return snapshotState();
      const raw = read();
      // Version and strict structural validation precede all normalization.
      const source = raw === null ? null : inspect(raw);
      let initialState;
      try {
        lastState = source === null ? root.SpendoBudgetCore.blankState() : root.SpendoBudgetCore.normalizeState(source).state;
        initialState = snapshotState();
      } catch {
        return protect('Nie udało się bezpiecznie przygotować danych do uruchomienia Pulnory. Zapis został zablokowany. Twoje dane nie zostały zmienione. Spróbuj otworzyć aplikację ponownie.');
      }
      baseline = raw;
      loaded = true;
      // Never automatically persist a normalized state during startup.
      return initialState;
    }
    function snapshotState() {
      return JSON.parse(JSON.stringify(lastState));
    }
    function getItem(key) {
      if (key !== KEY) throw new Error('Niedozwolony klucz danych.');
      return check();
    }
    function setItem(key, serialized) {
      if (key !== KEY) throw new Error('Niedozwolony klucz danych.');
      check();
      // Also protect against an unsupported or damaged outgoing state.
      const source = inspect(serialized);
      try { getStorage().setItem(KEY, serialized); }
      catch { throw new Error('Nie udało się zapisać danych na urządzeniu (np. brak miejsca). Poprzedni zapis pozostaje bez zmian.'); }
      baseline = serialized;
      lastState = root.SpendoBudgetCore.normalizeState(source).state;
    }
    return Object.freeze({ load, check, getItem, setItem, snapshotState,
      removeItem() { throw new Error('Usuwanie danych jest zablokowane przez ochronę pamięci.'); } });
  }
  root.SpendoDataSafety = Object.freeze({ create });
})(window);
