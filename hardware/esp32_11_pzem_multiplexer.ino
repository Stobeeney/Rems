#include <PZEM004Tv30.h>
// Aircon IR control: IRremoteESP8266. With ESP32 board package 3.x, install it from GitHub
// (https://github.com/crankyoldgit/IRremoteESP8266 -> Code -> Download ZIP, then
// Sketch -> Include Library -> Add .ZIP Library). The 2.8.6 Library Manager release does not compile on 3.x.
#include <IRremoteESP8266.h>
#include <IRac.h>
#include <IRutils.h>

// =============================================================================
// Aircon IR transmitters (one per room). Module pins: DAT -> GPIO, VCC -> 5V, GND -> GND
// =============================================================================
#define IR_PIN_UNIT1 4   // Room 1 (Master Bedroom) aircon, paired with Pi relay 7
#define IR_PIN_UNIT2 13  // Room 2 (Bedroom 2) aircon, paired with Pi relay 20

// Aircon brand protocol + model per room. Swap the two units if the rooms are reversed.
//   AUX ASW-09A2/QCDI (inverter)  -> ELECTRA_AC (the library's AUX protocol), model 1
//   Panasonic CS-PC9KKQ           -> PANASONIC_AC, model 3 (DKE) is the usual remote;
//                                    older A75C2311-type remotes are model 5 (CKP)
// To confirm: wire a VS1838B IR receiver to a free GPIO, flash the library example
// "IRrecvDumpV2", press ON on the original remote. It prints "Protocol :" and "Model:".
const decode_type_t AC_PROTOCOL_UNIT1 = decode_type_t::ELECTRA_AC;   // Room 1: AUX
const int16_t       AC_MODEL_UNIT1    = 1;
const decode_type_t AC_PROTOCOL_UNIT2 = decode_type_t::PANASONIC_AC; // Room 2: Panasonic
const int16_t       AC_MODEL_UNIT2    = 3;                            // 3 = DKE, 5 = CKP
const float AC_SET_TEMP_C = 24.0;   // temperature sent with the ON command

IRac acUnit1(IR_PIN_UNIT1);
IRac acUnit2(IR_PIN_UNIT2);

// Multiplexer Address Select Pins
#define PIN_S0 25
#define PIN_S1 26
#define PIN_S2 27
#define PIN_S3 32

// PZEM Serial Communication Pins (HardwareSerial 1)
#define PZEM_RX_PIN 19 // ESP32 RX <- MUX SIG <- PZEM TX
#define PZEM_TX_PIN 18 // ESP32 TX -> PZEM RX of all 11 PZEMs (shared bus, 3.3V logic)

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

void setupAircon(IRac &ac, decode_type_t protocol, int16_t model) {
    ac.next.protocol = protocol;
    ac.next.model = model;
    ac.next.mode = stdAc::opmode_t::kCool;
    ac.next.celsius = true;
    ac.next.degrees = AC_SET_TEMP_C;
    ac.next.fanspeed = stdAc::fanspeed_t::kAuto;
    ac.next.swingv = stdAc::swingv_t::kAuto;
    ac.next.swingh = stdAc::swingh_t::kOff;
    ac.next.light = true;
    ac.next.beep = true;
    ac.next.power = false;
}

// Sends the aircon ON/OFF code and acknowledges to the Pi: {"ir":1,"power":"on","ok":true}
void sendAircon(int unit, bool powerOn) {
    IRac *ac = (unit == 1) ? &acUnit1 : (unit == 2) ? &acUnit2 : nullptr;
    bool ok = false;
    if (ac != nullptr && IRac::isProtocolSupported(ac->next.protocol)) {
        ac->next.power = powerOn;
        ok = ac->sendAc();
    }
    Serial.print("{\"ir\":");
    Serial.print(unit);
    Serial.print(",\"power\":\"");
    Serial.print(powerOn ? "on" : "off");
    Serial.print("\",\"ok\":");
    Serial.print(ok ? "true" : "false");
    Serial.println("}");
}

// Reads command lines from the Pi without blocking, e.g. {"cmd":"ir","unit":1,"power":"on"}
String piLine;
void pollPiCommands() {
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\n' || c == '\r') {
            if (piLine.indexOf("\"cmd\":\"ir\"") >= 0) {
                int u = piLine.indexOf("\"unit\":");
                int unit = (u >= 0) ? piLine.substring(u + 7).toInt() : 0;
                bool powerOn = piLine.indexOf("\"power\":\"on\"") >= 0;
                sendAircon(unit, powerOn);
            }
            piLine = "";
        } else if (piLine.length() < 120) {
            piLine += c;
        }
    }
}

// delay() that keeps answering the Pi
void delayPolling(unsigned long ms) {
    unsigned long start = millis();
    while (millis() - start < ms) {
        pollPiCommands();
        delay(5);
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000);

    setupAircon(acUnit1, AC_PROTOCOL_UNIT1, AC_MODEL_UNIT1);
    setupAircon(acUnit2, AC_PROTOCOL_UNIT2, AC_MODEL_UNIT2);

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

        delayPolling(35);
    }

    delayPolling(400);
}
