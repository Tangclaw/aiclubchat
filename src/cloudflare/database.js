function bindParameters(parameters) {
  return parameters.map((value) => value === undefined ? null : value);
}

export function createDurableDatabase(storage) {
  const sql = storage.sql;

  return {
    isOpen: true,
    exec(statement) {
      const cursor = sql.exec(statement);
      cursor.toArray();
      return this;
    },
    prepare(statement) {
      return {
        all(...parameters) {
          return sql.exec(statement, ...bindParameters(parameters)).toArray();
        },
        get(...parameters) {
          return sql.exec(statement, ...bindParameters(parameters)).toArray()[0];
        },
        run(...parameters) {
          const cursor = sql.exec(statement, ...bindParameters(parameters));
          cursor.toArray();
          return {
            changes: cursor.rowsWritten,
            lastInsertRowid: 0,
          };
        },
      };
    },
    transaction(action) {
      return storage.transactionSync(action);
    },
    close() {},
  };
}
