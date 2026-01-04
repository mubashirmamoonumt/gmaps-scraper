const express = require('express');
const { scrapeGoogleMaps } = require('./index');

const app = express();
const PORT = process.env.PORT || 3030;

    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test using: curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/scrape?q=Pizza&limit=3"`);
});
