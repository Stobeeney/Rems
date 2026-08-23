# Hardware / ESP32 Code

This folder will contain all the C++ code for the ESP32 microcontroller.

## Setup Instructions

1. Use **Arduino IDE** or **PlatformIO** to compile and upload code to your ESP32.
2. The ESP32 should read sensors (e.g., ZMPT101B for voltage, ACS712 or SCT-013 for current).
3. The ESP32 must connect to the same Wi-Fi network as the Raspberry Pi.
4. Send HTTP POST requests to the Raspberry Pi's backend API.

## Example HTTP POST from ESP32

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Replace with your Raspberry Pi's IP Address
const char* serverName = "http://<RASPBERRY_PI_IP>:5000/api/data";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("Connected to WiFi");
}

void loop() {
  if(WiFi.status()== WL_CONNECTED){
    HTTPClient http;
    
    // Your sensor reading logic goes here
    float voltage = 221.5;
    float current = 4.2;
    float power_factor = 0.94;
    
    // Create JSON payload
    String jsonPayload = "{\"voltage\":" + String(voltage) + 
                         ",\"current\":" + String(current) + 
                         ",\"power_factor\":" + String(power_factor) + "}";
    
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");
    
    int httpResponseCode = http.POST(jsonPayload);
    
    Serial.print("HTTP Response code: ");
    Serial.println(httpResponseCode);
    
    http.end();
  }
  
  // Send data every 5 seconds
  delay(5000);
}
```
