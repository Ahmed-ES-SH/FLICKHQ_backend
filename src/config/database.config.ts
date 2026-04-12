import { User } from '../user/schema/user.schema';
import { DataSourceOptions, DataSource } from 'typeorm';
import { config } from 'dotenv';
import { BlackList } from '../auth/schema/blacklisk-tokens.schema';
import { ContactMessage } from '../contact/schema/contact-message.schema';
import { Article } from '../blog/schema/article.schema';
import { Category } from '../categories/schema/category.schema';
import { Notification } from '../notifications/schema/notification.schema';
import { NotificationPreferences } from '../notifications/schema/notification-preferences.schema';

// Config
config({ path: '.env' });

// Data Source Options
export const databaseConfig: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    User,
    BlackList,
    ContactMessage,
    Article,
    Category,
    Notification,
    NotificationPreferences,
  ],
  synchronize: false,
  logging: false,
  migrations: ['dist/db/migrations/*.js'],
};

const dataSource = new DataSource(databaseConfig);

export default dataSource;
