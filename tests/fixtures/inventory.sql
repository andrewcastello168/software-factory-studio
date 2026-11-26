CREATE TABLE categories (
  id integer PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE suppliers (
  id integer PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE warehouses (
  id integer PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE products (
  id integer PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id integer NOT NULL REFERENCES categories (id),
  supplier_id integer REFERENCES suppliers (id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT TRUE,
  CHECK (length(name) > 0)
);

CREATE INDEX products_category_idx ON products (category_id);

CREATE TABLE stock_movements (
  id integer PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products (id),
  warehouse_id integer NOT NULL REFERENCES warehouses (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  recorded_on date NOT NULL DEFAULT CURRENT_DATE
);
