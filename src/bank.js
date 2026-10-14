// The socket bank: 8,192 sockets on a wall 128 columns wide and 64 rows tall,
// 1.2 units (1.325 m) apart -- 169.6 m x 84.8 m of machine. Slot 04031 is
// column 63, row 31, and it is the only socket on the wall that is still lit:
// the request, the cable and the deletion are all about that one place.
//
// Three chapters name this wall, so its numbers live in one module instead of
// being typed three times. Rule 3 of the film says a readout has to be
// supported by geometry: the tallies come from the same array the sockets are
// written from, and when the OK key is pressed the wall in `error` is rebuilt
// with one instance fewer. The geometry is the ledger.

export const BANK = {
  cols: 128,
  rows: 64,
  pitch: 1.2,                 // units between sockets (1.325 m)
  get slots() { return this.cols * this.rows; },
  col: 63,
  row: 31,
  get index() { return this.col + this.row * this.cols; },   // 04031
  bay: 8,                     // sockets per rack bay (16 x 8 bays)
};

export const BAYS_X = BANK.cols / BANK.bay;
export const BAYS_Y = BANK.rows / BANK.bay;

// Where socket `i` sits relative to hers, in the wall's own plane: x to the
// right, y up, both in the wall's units.
export function slotOff(i) {
  return [
    ((i % BANK.cols) - BANK.col) * BANK.pitch,
    (((i / BANK.cols) | 0) - BANK.row) * BANK.pitch,
  ];
}

// The wall's own account. The sockets that are installed, the one that is
// still lit, and -- after the press -- the one that is not on the wall any
// more. installed + live + removed always adds up to 8,192: the record keeps
// its total even when the geometry loses a slot.
export function bankCounts(removed = false) {
  const gone = removed ? 1 : 0;
  return {
    installed: BANK.slots - gone,
    live: 1 - gone,
    removed: gone,
    dark: BANK.slots - 1,     // "answered, and dark": 8,191 either way
  };
}
