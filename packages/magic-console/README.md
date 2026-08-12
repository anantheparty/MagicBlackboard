# Magic Console

Development-only observability UI for one Magic runtime. It never owns a global
runtime, does not call a model, and unsubscribes from runtime/canvas events while
closed. Toggle it with `Cmd/Ctrl + Shift + D`.

The Input tab reads only the runtime's compact `inkDiagnostics` snapshots. It subscribes while the
console is open on that tab, batches repeated diagnostics notifications into one animation-frame
refresh, and unsubscribes/cancels a pending frame on tab change, close, or unmount. It never receives
raw pointer events, coordinates, or full stroke histories.
