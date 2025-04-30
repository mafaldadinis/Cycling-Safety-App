import { BleClient } from '@capacitor-community/bluetooth-le';
import type { BleDevice } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let watchDevice: BleDevice | null = null;
let locationWatchId: string | number | null = null;

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
    <h1>ESP32 Watch Connector</h1>
    <button id="btn-connect">Connect</button>
    <button id="btn-disconnect" disabled>Disconnect</button>
    <button id="btn-send" disabled>Send Hello</button>
    <p id="status">Status: Disconnected</p>
    <p id="accel">Accel: x:N/A y:N/A z:N/A</p>
    <p id="loc">Loc: lat:N/A lon:N/A</p>
  `;

  document.getElementById('btn-connect')!.addEventListener('click', connectWatch);
  document.getElementById('btn-disconnect')!.addEventListener('click', disconnectWatch);
  document.getElementById('btn-send')!.addEventListener('click', sendTest);

  // Start continuous location updates
  locationWatchId = Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    (position, err) => {
      if (position) {
        const { latitude, longitude } = position.coords;
        document.getElementById('loc')!.textContent =
          `Loc: lat:${latitude.toFixed(6)} lon:${longitude.toFixed(6)}`;
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
