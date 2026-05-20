import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMovieIndexes1775975939706 implements MigrationInterface {
  name = 'AddMovieIndexes1775975939706';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GIN index for full-text search on title
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_movies_title_search 
            ON movies USING gin(to_tsvector('english', title))
        `);

    // Index on release_date for sorting
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_movies_release_date 
            ON movies (release_date DESC)
        `);

    // Index on tmdb_id (already unique, but ensure B-tree index exists)
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id 
            ON movies ("tmdbId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_movies_title_search`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_movies_release_date`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_movies_tmdb_id`);
  }
}
