export type FieldType = 'smallint' | 'integer' | 'text' | 'boolean' | 'uuid' | 'date';
export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export interface Field { name: string; type: FieldType; nullable: boolean; hasDefault: boolean }
export interface Table { name: string; key: string; columns: readonly Field[] }

export const tables: readonly Table[] = @@CRUDDEFINITIONS@@;

@@CRUDTYPES@@
