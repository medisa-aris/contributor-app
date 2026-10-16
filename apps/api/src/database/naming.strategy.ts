import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

/** Maps camelCase entity properties to snake_case database identifiers. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(target: unknown, userSpecifiedName?: string): string {
    if (userSpecifiedName) return userSpecifiedName;
    return snakeCase((target as { name: string }).name);
  }

  override columnName(
    propertyName: string,
    customName?: string,
    embeddedPrefixes: string[] = [],
  ): string {
    return customName ?? snakeCase([...embeddedPrefixes, propertyName].join('_'));
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
  ): string {
    return snakeCase(`${firstTableName}_${firstPropertyName.replaceAll('.', '_')}_${secondTableName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }
}
