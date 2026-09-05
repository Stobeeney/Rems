#include <PZEM004Tv30.h>

// Multiplexer Address Select Pins
#define PIN_S0 25
#define PIN_S1 26
#define PIN_S2 27
#define PIN_S3 32

// PZEM Serial Communication Pins (HardwareSerial 1)
#define PZEM_RX_PIN 19 // ESP32 RX <- MUX SIG <- PZEM TX
#define PZEM_TX_PIN 18 // ESP32 TX -> Level Converter -> PZEM RX (Shared)

// 11 PZEMs: C0 (Main Panel) + C1 to C10 (10 Branches)
#define TOTAL_PZEM_CHANNELS 11

HardwareSerial PzemSerial(1);
PZEM004Tv30 pzem(PzemSerial, PZEM_RX_PIN, PZEM_TX_PIN);

void selectMuxChannel(uint8_t ch) {
    digitalWrite(PIN_S0, (ch & 0x01) ? HIGH : LOW);
    digitalWrite(PIN_S1, (ch & 0x02) ? HIGH : LOW);
    digitalWrite(PIN_S2, (ch & 0x04) ? HIGH : LOW);
    digitalWrite(PIN_S3, (ch & 0x08) ? HIGH : LOW);
    delay(20); // Switching settling time
}

void setup() {
    Serial.begin(115200);
    delay(1000);

    pinMode(PIN_S0, OUTPUT);
    pinMode(PIN_S1, OUTPUT);
    pinMode(PIN_S2, OUTPUT);
    pinMode(PIN_S3, OUTPUT);

    selectMuxChannel(0);
    Serial.println("ESP32_PZEM_MUX_READY");
}

void loop() {
    for (uint8_t ch = 0; ch < TOTAL_PZEM_CHANNELS; ch++) {
        selectMuxChannel(ch);

        // Flush previous serial bytes
        while (PzemSerial.available()) {
            PzemSerial.read();
        }

        float voltage = pzem.voltage();

        if (!isnan(voltage) && voltage > 10.0) {
            float current   = pzem.current();
            float power     = pzem.power();
            float energy    = pzem.energy();
            float frequency = pzem.frequency();
            float pf        = pzem.pf();

            if (isnan(current))   current   = 0.0;
            if (isnan(power))     power     = 0.0;
            if (isnan(energy))    energy    = 0.0;
            if (isnan(frequency)) frequency = 60.0;
            if (isnan(pf))        pf        = 1.0;

            Serial.print("{\"channel\":");
            Serial.print(ch);
            Serial.print(",\"status\":\"ONLINE\",\"voltage\":");
            Serial.print(voltage, 1);
            Serial.print(",\"current\":");
            Serial.print(current, 2);
            Serial.print(",\"power\":");
            Serial.print(power, 1);
            Serial.print(",\"pf\":");
            Serial.print(pf, 2);
            Serial.print(",\"freq\":");
            Serial.print(frequency, 1);
            Serial.print(",\"energy\":");
            Serial.print(energy, 2);
            Serial.println("}");
        } else {
            Serial.print("{\"channel\":");
            Serial.print(ch);
            Serial.println(",\"status\":\"STANDBY\",\"voltage\":0.0,\"current\":0.0,\"power\":0.0,\"pf\":0.0,\"freq\":0.0,\"energy\":0.0}");
        }

        delay(35);
    }

    delay(400);
}
