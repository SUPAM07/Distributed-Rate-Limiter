import * as fs from 'fs';
import * as path from 'path';

// Cache for loaded scripts: filename -> content
const scriptCache = new Map<string, string>();

/**
 * Loads a Lua script from the src/limiter/lua directory.
 * Caches the script in memory after the first read.
 * 
 * @param filename - The name of the Lua script file (e.g., 'tokenBucket.lua')
 * @returns The contents of the Lua script as a string
 */
export function loadLuaScript(filename: string): string {
  if (scriptCache.has(filename)) {
    return scriptCache.get(filename)!;
  }

  // Resolve path safely whether running from src/ or dist/
  const scriptPath = path.resolve(__dirname, '..', '..', '..', 'src', 'limiter', 'lua', filename);
  
  try {
    const content = fs.readFileSync(scriptPath, 'utf8');
    scriptCache.set(filename, content);
    return content;
  } catch (error) {
    throw new Error(`Failed to load Lua script: ${filename}. ${error instanceof Error ? error.message : String(error)}`);
  }
}
