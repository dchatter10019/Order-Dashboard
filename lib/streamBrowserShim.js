/** Stub for Node `stream` so xlsx-js-style does not pull broken browser externals in Vite. */
export class Readable {
  constructor() {
    throw new Error('stream.Readable is not available in the browser')
  }
}

export default { Readable }
