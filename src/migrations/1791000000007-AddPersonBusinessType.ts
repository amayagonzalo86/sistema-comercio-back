import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonBusinessType1791000000007 implements MigrationInterface {
  name = 'AddPersonBusinessType1791000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE persons ADD COLUMN person_type ENUM('CUSTOMER','SUPPLIER','BOTH') NOT NULL DEFAULT 'BOTH'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE persons DROP COLUMN person_type');
  }
}
