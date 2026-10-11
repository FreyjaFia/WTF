// jsdom cannot parse modern CSS (e.g. @layer, nesting) in component styles and reports
// "Could not parse CSS stylesheet" for each one. It is harmless noise in unit tests.
const noise = 'Could not parse CSS stylesheet';

const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes(noise))) {
    return;
  }
  originalError(...args);
};

const originalWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
  if (String(chunk).includes(noise)) {
    return true;
  }
  return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;
