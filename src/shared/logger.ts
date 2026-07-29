/**
 * Shared structured logger.
 * Formats log entries as JSON strings for easy parsing by observability tools.
 */
export const logger = {
  info(event: string, data: Record<string, unknown> = {}) {
    console.log(
      JSON.stringify({
        level: 'info',
        event,
        ...data,
        ts: new Date().toISOString(),
      })
    );
  },

  error(event: string, message: string, data: Record<string, unknown> = {}) {
    console.error(
      JSON.stringify({
        level: 'error',
        event,
        message,
        ...data,
        ts: new Date().toISOString(),
      })
    );
  },

  warn(event: string, message: string, data: Record<string, unknown> = {}) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event,
        message,
        ...data,
        ts: new Date().toISOString(),
      })
    );
  }
};
