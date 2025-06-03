// Linear color scale from green (0) to red (1)
function getColor(value: number): string {
  const r = Math.round(255 * value);
  const g = Math.round(255 * (1 - value));
  return `rgb(${r},${g},0)`;
}
import { BleClient } from '@capacitor-community/bluetooth-le';
import type { BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let watchDevice: BleDevice | null = null;
let locationWatchId: string | number | null = null;

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let csvLayer: L.LayerGroup | null = null;

async function initialize() {
  if (!document.getElementById('app')) {
    throw new Error('No <div id="app"></div> found in index.html');
  }

  // Request location permission on Android
  if (Capacitor.getPlatform() === 'android') {
    await Geolocation.requestPermissions();
  }

  // Initialize BLE client
  await BleClient.initialize();

  // Build user interface
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="button-group">
      <button id="btn-connect">Connect</button>
      <button id="btn-disconnect" disabled>Disconnect</button>
      <button id="btn-send" disabled>Send Hello</button>
    </div>
    <button id="btn-toggle-csv">Toggle CSV Layer</button>
    <div id="status">Status: Disconnected</div>
    <div id="accel">Accel: x:N/A y:N/A z:N/A</div>
    <div id="loc">Loc: lat:N/A lon:N/A</div>
    <div id="map"></div>
  `;

  document.getElementById('btn-connect')!.addEventListener('click', connectWatch);
  document.getElementById('btn-disconnect')!.addEventListener('click', disconnectWatch);
  document.getElementById('btn-send')!.addEventListener('click', sendTest);

  // CSV markers layer setup
  document.getElementById('btn-toggle-csv')!.addEventListener('click', () => {
    if (!csvLayer || !map) return;
    if (map.hasLayer(csvLayer)) {
      map.removeLayer(csvLayer);
    } else {
      map.addLayer(csvLayer);
    }
  });

  // Start continuous location updates
  locationWatchId = Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 1000, maximumAge: 0 },
    (position, err) => {
      if (position) {
        const {
          latitude,
          longitude,
          altitude,
          accuracy,
          altitudeAccuracy,
          heading,
          speed
        } = position.coords;

        const timestamp = position.timestamp;

        const info = `
      Loc: lat:${latitude.toFixed(6)} lon:${longitude.toFixed(6)}
      Altitude: ${altitude ?? 'N/A'} m
      Accuracy: ${accuracy} m
      Altitude Accuracy: ${altitudeAccuracy ?? 'N/A'} m
      Heading: ${heading ?? 'N/A'}°
      Speed: ${speed ? (speed * 3.6).toFixed(1) : 'N/A'} km/h
      Timestamp: ${new Date(timestamp).toISOString()}
    `;

        document.getElementById('loc')!.textContent = info;

        const mapEl = document.getElementById('map');

        if (mapEl && !map) {
          map = L.map('map').setView([latitude, longitude], 15);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);
          // Create a rotating arrow icon
          const arrowIcon = L.divIcon({
            className: 'arrow-icon',
            html: '<div class="arrow"></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
          marker = L.marker([latitude, longitude], { icon: arrowIcon }).addTo(map);
          marker.getElement()?.querySelector('.arrow')?.setAttribute('style', `transform: rotate(${heading ?? 0}deg)`);
          setTimeout(() => map!.invalidateSize(), 100);

          // --- CSV LayerGroup and marker loading ---
          csvLayer = L.layerGroup().addTo(map);
          fetch('/data.csv')
            .then(res => res.text())
            .then(csvText => {
              const lines = csvText.trim().split('\n');
              for (const line of lines.slice(1)) {
                const [latStr, lonStr, valueStr, ...rest] = line.split(',');
                const lat = parseFloat(latStr);
                const lon = parseFloat(lonStr);
                // Support optional value column for color
                let value = 0;
                let markerLabel = '';
                if (!isNaN(parseFloat(valueStr))) {
                  value = Math.max(0, Math.min(1, parseFloat(valueStr)));
                  markerLabel = rest.join(',').trim();
                } else {
                  markerLabel = [valueStr, ...rest].join(',').trim();
                }
                // Use circle marker with color scale
                const color = getColor(value);
                const marker = L.circleMarker([lat, lon], {
                  radius: 4,
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.8,
                  weight: 2
                }).bindPopup(markerLabel || `${lat}, ${lon}, ${value}`);
                csvLayer!.addLayer(marker);
              }
            })
            .catch(err => console.error('Failed to load CSV markers:', err));
          // --- end CSV marker loading ---
        } else if (map && marker) {
          marker.setLatLng([latitude, longitude]);
          map.setView([latitude, longitude]);
          marker.getElement()?.querySelector('.arrow')?.setAttribute('style', `transform: rotate(${heading ?? 0}deg)`);
        }

        const csv = [
          latitude,
          longitude,
          altitude,
          accuracy,
          altitudeAccuracy,
          heading,
          speed,
          timestamp
        ].map(val => (val !== null ? val : 'null')).join(',');

        console.log('Geolocation :', csv);

        // Optionally send CSV over Bluetooth if connected
        if (watchDevice) {
          const encoder = new TextEncoder();
          const data = encoder.encode(csv);
          const dataView = new DataView(data.buffer);
          try {
            BleClient.write(
              watchDevice.deviceId,
              SERVICE_UUID,
              CHARACTERISTIC_UUID,
              dataView
            );
          } catch (err) {
            console.error('Error sending location data over BLE:', err);
          }
        }
      } else {
        console.error('Location watch error', err);
      }
    }
  );
}

async function connectWatch() {
  const statusEl = document.getElementById('status')!;
  statusEl.textContent = 'Status: Connecting...';
  document.getElementById('btn-connect')!.setAttribute('disabled', 'true');

  try {
    // Ensure Bluetooth is on
    if (!(await BleClient.isEnabled())) {
      await BleClient.requestEnable();
    }

    // Scan and connect to device
    watchDevice = await BleClient.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    });
    await BleClient.connect(watchDevice.deviceId);
    statusEl.textContent = 'Status: Connected';
    document.getElementById('btn-disconnect')!.removeAttribute('disabled');
    document.getElementById('btn-send')!.removeAttribute('disabled');

    // Start receiving accelerometer notifications
    await BleClient.startNotifications(
      watchDevice.deviceId,
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      handleNotification
    );
  } catch (err) {
    console.error('Connection failed', err);
    statusEl.textContent = 'Status: Connection Failed';
    document.getElementById('btn-connect')!.removeAttribute('disabled');
  }
}

async function disconnectWatch() {
  const statusEl = document.getElementById('status')!;
  if (watchDevice) {
    try {
      await BleClient.stopNotifications(
        watchDevice.deviceId,
        SERVICE_UUID,
        CHARACTERISTIC_UUID
      );
      await BleClient.disconnect(watchDevice.deviceId);
    } catch (err) {
      console.error('Error during disconnect', err);
    }
  }
  statusEl.textContent = 'Status: Disconnected';
  document.getElementById('btn-connect')!.removeAttribute('disabled');
  document.getElementById('btn-disconnect')!.setAttribute('disabled', 'true');
  document.getElementById('btn-send')!.setAttribute('disabled', 'true');
}

// Test write to BLE device
async function sendTest() {
  if (!watchDevice) {
    console.warn('No device connected');
    return;
  }
  const text = 'hello';
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const dataView = new DataView(data.buffer);
  try {
    await BleClient.write(
      watchDevice.deviceId,
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      dataView
    );
    console.log('Sent hello to watch');
  } catch (err) {
    console.error('Error sending hello:', err);
  }
}

function handleNotification(value: DataView) {
  // Debug: print raw DataView notification
  console.log('Raw DataView notification:', value);
  // Convert DataView to a Uint8Array
  const data = new Uint8Array(value.buffer);
  console.log('Received data array:', data);
  // Decode bytes to a string
  const json = new TextDecoder().decode(data);
  console.log('Decoded JSON string:', json);
  // Attempt JSON parse and update UI
  try {
    const accel = JSON.parse(json);
    document.getElementById('accel')!.textContent =
      `Accel: x:${accel.x} y:${accel.y} z:${accel.z}`;
  } catch (err) {
    console.error('Error parsing JSON from DataView:', err);
  }
}

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
