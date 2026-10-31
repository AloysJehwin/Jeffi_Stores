import { groupSql, unassignedSql } from './categories'

// Brands share the category grouping (./categories) keyed on brand_id.
export const BRANDS_SQL = groupSql('brand')
export const UNBRANDED_SQL = unassignedSql('brand')
