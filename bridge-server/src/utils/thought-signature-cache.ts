/**
 * In-memory cache for preserving Gemini thought signatures across tool call turns.
 */
class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;

  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
  }

  override set(key: K, value: V): this {
    if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }
    return super.set(key, value);
  }
}

export const thoughtSignatureCache = new BoundedMap<string, string>(2000);
export const lastThoughtSignatureByTool = new BoundedMap<string, string>(500);
export const toolCallNameCache = new BoundedMap<string, string>(2000);

