// Two parallel workers can create something in the same millisecond, so chance alone is not enough: the stamp carries the
// worker's number (unique among the workers running together) and a counter that never repeats inside one worker.
let counter = 0;

function worker(): string {
  return (Number(process.env.TEST_PARALLEL_INDEX ?? 0) % 36).toString(36);
}

function sequence(): string {
  counter = (counter + 1) % 1296;
  return counter.toString(36).padStart(2, '0');
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${worker()}${sequence()}`;
}

export function uniqueCode(prefix: string = 'E'): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}${worker()}${sequence()}`.slice(0, 10).toUpperCase();
}

export function uniqueUsername(prefix: string = 'e2e'): string {
  return `${prefix}${Date.now().toString(36)}${worker()}${sequence()}`.toLowerCase();
}

export function uniqueStamp(): string {
  return `${Date.now().toString(36)}${worker()}${sequence()}`;
}
