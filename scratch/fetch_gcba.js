const fs = require('fs');

async function testFetch() {
  const clientId = "3e5e59431f5b4007a5df945007ad47e1";
  const clientSecret = "c64a5F5972dA4A9C9Da51020c67d1112";
  const url = `https://apitransporte.buenosaires.gob.ar/subtes/forecastGTFS?client_id=${clientId}&client_secret=${clientSecret}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    
    console.log("Stops for Line B in GCBA Live Forecast payload:");
    const lineB = data.Entity?.filter(e => e.Linea && e.Linea.Route_Id === 'LineaB');
    if (lineB && lineB.length > 0) {
      lineB.forEach(e => {
        console.log(`Trip ID: ${e.Linea.Trip_Id}`);
        e.Linea.Estaciones?.forEach(est => {
          console.log(`  Stop ID in API: ${est.stop_id}, stop_name: ${est.stop_name}`);
        });
      });
    } else {
      console.log("No Line B trips found in feed.");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

testFetch();
