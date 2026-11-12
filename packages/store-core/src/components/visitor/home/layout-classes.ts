// Shared by HomeSections and the loading skeletons, which must lay rows out identically.
// A half section keeps its own container inside its column; the gap-less grid lets each half keep
// its background. Below lg the two stack in row order.
export const HALF_ROW = 'grid lg:grid-cols-2'
export const HALF_CELL = 'min-w-0 overflow-hidden [&_.container]:max-w-none [&_.container]:px-4 md:[&_.container]:px-6'
