import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '12345',
  database: process.env.DB_NAME || 'sistema_comercio',

  entities: ['dist/**/*.entity.js'],

  migrations: ['dist/migrations/*.js'],

  synchronize: false,

  logging: true,
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;