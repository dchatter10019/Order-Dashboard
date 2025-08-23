# Bevvi Order Tracking System

A modern, responsive web application for tracking and managing Bevvi orders with authentication, filtering capabilities, and detailed order views.

## Features

- 🔐 **User Authentication**: Secure login with predefined credentials
- 📅 **Date Range Selection**: Customizable start and end dates for order queries
- 🔍 **Advanced Filtering**: Filter by order status and delivery dates
- 📊 **Real-time Statistics**: Total orders, status counts, and revenue tracking
- 📋 **Order Management**: Comprehensive order listing with clickable details
- 📱 **Responsive Design**: Modern UI that works on all devices
- 🎨 **Bevvi Branding**: Consistent with Bevvi's design aesthetic

## Authentication

**Username:** `Bevvi_User`  
**Password:** `Bevvi_123#`

## API Integration

The system integrates with the Bevvi API endpoint:
```
https://api.getbevvi.com/api/bevviutils/getAllTransactionsReportCsv?startDate={startDate}&endDate={endDate}
```

## Technology Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Backend**: Node.js, Express
- **Icons**: Lucide React
- **Styling**: Custom CSS with Tailwind utilities

## Project Structure

```
bevvi-order-tracking-system/
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx          # Main dashboard component
│   │   ├── Login.jsx              # Authentication component
│   │   ├── OrderModal.jsx         # Order details popup
│   │   ├── DateRangePicker.jsx    # Date selection component
│   │   ├── StatusFilter.jsx       # Status filtering
│   │   └── DeliveryFilter.jsx     # Delivery date filtering
│   ├── App.jsx                    # Main application component
│   ├── main.jsx                   # React entry point
│   ├── index.css                  # Global styles
│   └── App.css                    # App-specific styles
├── server.js                      # Express backend server
├── package.json                   # Dependencies and scripts
├── vite.config.js                 # Vite configuration
├── tailwind.config.js             # Tailwind CSS configuration
└── README.md                      # Project documentation
```

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd bevvi-order-tracking-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **In a new terminal, start the backend server**
   ```bash
   npm start
   ```

### Development Commands

- `npm run dev` - Start Vite development server (frontend)
- `npm start` - Start Express backend server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Usage

1. **Login**: Use the provided credentials to access the system
2. **Select Date Range**: Choose start and end dates for order queries
3. **Fetch Orders**: Click "Fetch Orders" to retrieve data from the API
4. **Filter Orders**: Use status and delivery date filters to narrow results
5. **View Details**: Click on any order row to see detailed information
6. **Search**: Use the search bar to find specific orders

## Features in Detail

### Order Status Tracking
- **Delivered**: Successfully completed orders
- **In Transit**: Orders currently being shipped
- **Pending**: Orders awaiting processing
- **Cancelled**: Cancelled orders

### Filtering Options
- **Status Filter**: Filter by order status
- **Delivery Filter**: Filter by delivery dates (Today, Tomorrow, This Week)
- **Search**: Search by order ID, customer name, or status

### Statistics Dashboard
- Total number of orders
- Orders by status
- Total revenue (delivered orders only)
- Real-time updates

## API Endpoints

- `GET /api/orders` - Fetch orders by date range
- `GET /api/health` - Health check endpoint

## Production Deployment

1. **Build the frontend**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

The application will be available at the configured port (default: 3001).

## Environment Variables

Create a `.env` file in the root directory:

```env
PORT=3001
NODE_ENV=production
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support or questions, please contact the development team.

---

**Built with ❤️ for Bevvi**
