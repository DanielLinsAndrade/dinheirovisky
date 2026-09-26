CREATE VIRTUAL TABLE transaction_search USING fts5(description, notes, content='transactions', content_rowid='id', tokenize='trigram remove_diacritics 1');
INSERT INTO transaction_search(transaction_search) VALUES('rebuild');
CREATE TRIGGER transaction_search_insert AFTER INSERT ON transactions BEGIN
 INSERT INTO transaction_search(rowid,description,notes) VALUES(NEW.id,NEW.description,NEW.notes);
END;
CREATE TRIGGER transaction_search_delete AFTER DELETE ON transactions BEGIN
 INSERT INTO transaction_search(transaction_search,rowid,description,notes) VALUES('delete',OLD.id,OLD.description,OLD.notes);
END;
CREATE TRIGGER transaction_search_update AFTER UPDATE OF description,notes,id ON transactions BEGIN
 INSERT INTO transaction_search(transaction_search,rowid,description,notes) VALUES('delete',OLD.id,OLD.description,OLD.notes);
 INSERT INTO transaction_search(rowid,description,notes) VALUES(NEW.id,NEW.description,NEW.notes);
END;
