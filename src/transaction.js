export function runInTransaction(database, action) {
  if (typeof database.transaction === 'function') {
    return database.transaction(action);
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
