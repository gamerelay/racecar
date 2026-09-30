// Patching three's built-in shaders (onBeforeCompile) without silent misses: a `.replace` that
// can't find its chunk throws, so a three upgrade that renames one fails loudly instead of quietly
// dropping windows, liveries, glows or fades. Chains like String.replace; `.text` is the result.

export class Chunks {
  constructor(
    public text: string,
    private readonly name: string,
  ) {}

  replace(chunk: string, replacement: string): Chunks {
    if (!this.text.includes(chunk)) throw new Error(`shader patch (${this.name}): no ${chunk}`);
    this.text = this.text.replace(chunk, replacement);
    return this;
  }

  /** Adds `code` right after `chunk`. */
  after(chunk: string, code: string): Chunks {
    return this.replace(chunk, `${chunk}\n${code}`);
  }
}

export const chunks = (text: string, name = 'shader'): Chunks => new Chunks(text, name);
