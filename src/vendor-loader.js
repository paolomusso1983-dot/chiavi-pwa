// Carica SheetJS (vendorizzato in public/vendor, servito da /vendor/) solo quando serve
// (bottone "Importa da Excel"), per non appesantire il primo avvio dell'app.
let xlsxPromise = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${import.meta.env.BASE_URL}vendor/xlsx.full.min.js`;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("Impossibile caricare il modulo di importazione Excel."));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}
