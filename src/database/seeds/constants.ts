export const CATEGORIES_API_URL = 'https://dummyjson.com/products/categories';
export const PRODUCTS_API_URL = 'https://dummyjson.com/products';

export const BATCH_SIZE = 50;
export const API_PAGE_SIZE = 100;
export const API_TIMEOUT_MS = 30000;
export const API_MAX_RETRIES = 3;
export const API_RETRY_DELAY_MS = 1000;

export const SHORT_DESCRIPTION_MAX_LENGTH = 150;

export const AVAILABILITY_STATUS_MAP: Record<string, string> = {
  'in stock': 'In Stock',
  'low stock': 'Low Stock',
  'out of stock': 'Out of Stock',
  instock: 'In Stock',
  lowstock: 'Low Stock',
  outofstock: 'Out of Stock',
};

export const CATEGORY_META: Record<
  string,
  { color: string; icon: string; description: string }
> = {
  beauty: {
    color: '#FF6B9D',
    icon: 'face',
    description:
      'Discover premium beauty products including makeup, skincare, and cosmetics.',
  },
  fragrances: {
    color: '#9B59B6',
    icon: 'local_florist',
    description: 'Explore our curated collection of fragrances products',
  },
  furniture: {
    color: '#8B4513',
    icon: 'chair',
    description: 'Discover premium furniture for your home and office.',
  },
  groceries: {
    color: '#27AE60',
    icon: 'shopping_cart',
    description:
      'Fresh groceries and everyday essentials delivered to your door.',
  },
  'home-decoration': {
    color: '#F39C12',
    icon: 'home',
    description: 'Transform your space with beautiful home decoration items.',
  },
  'kitchen-accessories': {
    color: '#E67E22',
    icon: 'kitchen',
    description: 'Essential kitchen accessories for the modern home cook.',
  },
  laptops: {
    color: '#3498DB',
    icon: 'laptop',
    description: 'High-performance laptops for work, gaming, and creativity.',
  },
  'mens-shirts': {
    color: '#2C3E50',
    icon: 'checkroom',
    description: 'Stylish mens shirts for every occasion.',
  },
  'mens-shoes': {
    color: '#34495E',
    icon: 'running_shoes',
    description: 'Premium footwear for the modern man.',
  },
  'mens-watches': {
    color: '#1ABC9C',
    icon: 'watch',
    description: 'Timeless mens watches combining style and precision.',
  },
  'mobile-accessories': {
    color: '#E74C3C',
    icon: 'smartphone',
    description: 'Essential accessories for your mobile devices.',
  },
  motorcycle: {
    color: '#2C3E50',
    icon: 'two_wheeler',
    description: 'Motorcycle gear, parts, and accessories.',
  },
  'skin-care': {
    color: '#FFB6C1',
    icon: 'spa',
    description: 'Nourish your skin with premium skincare products.',
  },
  smartphones: {
    color: '#2980B9',
    icon: 'phone_android',
    description: 'Latest smartphones with cutting-edge technology.',
  },
  'sports-accessories': {
    color: '#16A085',
    icon: 'sports',
    description:
      'Quality sports accessories for athletes and fitness enthusiasts.',
  },
  sunglasses: {
    color: '#F1C40F',
    icon: 'eyeglasses',
    description: 'Stylish sunglasses for sun protection and fashion.',
  },
  tablets: {
    color: '#8E44AD',
    icon: 'tablet',
    description: 'Versatile tablets for productivity and entertainment.',
  },
  tops: {
    color: '#E91E63',
    icon: 'apparel',
    description: 'Trendy tops for every season and style.',
  },
  vehicle: {
    color: '#7F8C8D',
    icon: 'directions_car',
    description: 'Vehicle accessories and automotive essentials.',
  },
  'womens-bags': {
    color: '#D35400',
    icon: 'shopping_bag',
    description: 'Elegant bags and handbags for women.',
  },
  'womens-dresses': {
    color: '#C0392B',
    icon: 'checkroom',
    description: 'Beautiful dresses for every occasion.',
  },
  'womens-jewellery': {
    color: '#F1C40F',
    icon: 'diamond',
    description: 'Exquisite jewellery pieces for women.',
  },
  'womens-shoes': {
    color: '#E74C3C',
    icon: 'women_shoes',
    description: 'Stylish and comfortable footwear for women.',
  },
  'womens-watches': {
    color: '#16A085',
    icon: 'watch',
    description: 'Elegant womens watches for every style.',
  },
};

export const DEFAULT_CATEGORY_META = {
  color: '#95A5A6',
  icon: 'category',
  description: 'Browse our collection of products.',
};
