CREATE TABLE suppliers (
  id integer PRIMARY KEY,
  name text NOT NULL
);

ALTER TABLE products ADD COLUMN supplier_id integer;
ALTER TABLE products ADD CONSTRAINT products_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL;
