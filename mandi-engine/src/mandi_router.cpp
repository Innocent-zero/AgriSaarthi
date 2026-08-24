// ─────────────────────────────────────────────────────────────────────────────
//  AgriSaarthi — Mandi Net-Profit Optimization Engine
//  Reads a JSON payload (stdin | --file <path> | --json '<literal>'),
//  computes true net realisation per mandi after transport, commission and
//  handling, and emits a ranked JSON result on stdout.
//
//  Net = (price × volume) − fuel − commission − handling − hire
//  Fuel = trips × 2 × distance × (fuelPrice ÷ kmpl)
//  trips = ceil(volume ÷ vehicleCapacity)
//
//  Exit 0 = success, 1 = input/compute error (still emits JSON).
// ─────────────────────────────────────────────────────────────────────────────
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// ══════════════════════════ Minimal JSON (parse + serialise) ════════════════
namespace json {

class Value;
using Object = std::vector<std::pair<std::string, Value>>;
using Array  = std::vector<Value>;

class Value {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Value() : type_(Type::Null), bool_(false), num_(0.0) {}
    explicit Value(bool b) : type_(Type::Bool), bool_(b), num_(0.0) {}
    explicit Value(double n) : type_(Type::Number), bool_(false), num_(n) {}
    explicit Value(std::string s)
        : type_(Type::String), bool_(false), num_(0.0), str_(std::move(s)) {}
    explicit Value(Array a)
        : type_(Type::Array), bool_(false), num_(0.0), arr_(std::move(a)) {}
    explicit Value(Object o)
        : type_(Type::Object), bool_(false), num_(0.0), obj_(std::move(o)) {}

    Type type() const { return type_; }
    bool isNull()   const { return type_ == Type::Null; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray()  const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }
    bool isBool()   const { return type_ == Type::Bool; }

    double      asNumber() const { return num_; }
    bool        asBool()   const { return bool_; }
    const std::string& asString() const { return str_; }
    const Array&  asArray()  const { return arr_; }
    const Object& asObject() const { return obj_; }

    // Ordered-map lookup. Returns nullptr when the key is absent.
    const Value* find(const std::string& key) const {
        if (type_ != Type::Object) return nullptr;
        for (const auto& kv : obj_)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }

    double numberOr(const std::string& key, double fallback) const {
        const Value* v = find(key);
        if (!v) return fallback;
        if (v->isNumber()) return v->num_;
        if (v->isString()) {                    // tolerate "2100" from web forms
            try { return std::stod(v->str_); } catch (...) { return fallback; }
        }
        if (v->isBool()) return v->bool_ ? 1.0 : 0.0;
        return fallback;
    }

    std::string stringOr(const std::string& key, const std::string& fallback) const {
        const Value* v = find(key);
        if (!v) return fallback;
        if (v->isString()) return v->str_;
        if (v->isNumber()) {
            std::ostringstream os; os << v->num_; return os.str();
        }
        return fallback;
    }

    bool hasKey(const std::string& key) const { return find(key) != nullptr; }

    static void addMember(Object& o, const std::string& k, Value v) {
        o.emplace_back(k, std::move(v));
    }

private:
    Type type_;
    bool bool_;
    double num_;
    std::string str_;
    Array arr_;
    Object obj_;
};

class Parser {
public:
    explicit Parser(const std::string& text) : s_(text), i_(0) {}

    Value parse() {
        skipWs();
        Value v = parseValue();
        skipWs();
        if (i_ != s_.size())
            throw std::runtime_error("trailing characters after JSON document");
        return v;
    }

private:
    const std::string& s_;
    size_t i_;

    [[noreturn]] void fail(const std::string& msg) const {
        throw std::runtime_error(msg + " at offset " + std::to_string(i_));
    }

    void skipWs() {
        while (i_ < s_.size() &&
               (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r'))
            ++i_;
    }

    char peek() const {
        if (i_ >= s_.size()) throw std::runtime_error("unexpected end of JSON input");
        return s_[i_];
    }

    void expect(char c) {
        if (i_ >= s_.size() || s_[i_] != c)
            fail(std::string("expected '") + c + "'");
        ++i_;
    }

    Value parseValue() {
        skipWs();
        switch (peek()) {
            case '{': return parseObject();
            case '[': return parseArray();
            case '"': return Value(parseString());
            case 't': literal("true");  return Value(true);
            case 'f': literal("false"); return Value(false);
            case 'n': literal("null");  return Value();
            default:  return Value(parseNumber());
        }
    }

    void literal(const char* lit) {
        size_t n = std::char_traits<char>::length(lit);
        if (s_.compare(i_, n, lit) != 0) fail("invalid literal");
        i_ += n;
    }

    Value parseObject() {
        expect('{');
        Object obj;
        skipWs();
        if (peek() == '}') { ++i_; return Value(std::move(obj)); }
        while (true) {
            skipWs();
            std::string key = parseString();
            skipWs();
            expect(':');
            Value val = parseValue();
            obj.emplace_back(std::move(key), std::move(val));
            skipWs();
            if (peek() == ',') { ++i_; continue; }
            expect('}');
            break;
        }
        return Value(std::move(obj));
    }

    Value parseArray() {
        expect('[');
        Array arr;
        skipWs();
        if (peek() == ']') { ++i_; return Value(std::move(arr)); }
        while (true) {
            arr.push_back(parseValue());
            skipWs();
            if (peek() == ',') { ++i_; continue; }
            expect(']');
            break;
        }
        return Value(std::move(arr));
    }

    std::string parseString() {
        expect('"');
        std::string out;
        while (true) {
            if (i_ >= s_.size()) throw std::runtime_error("unterminated string");
            char c = s_[i_++];
            if (c == '"') break;
            if (c != '\\') { out.push_back(c); continue; }
            if (i_ >= s_.size()) throw std::runtime_error("bad escape");
            char e = s_[i_++];
            switch (e) {
                case '"':  out.push_back('"');  break;
                case '\\': out.push_back('\\'); break;
                case '/':  out.push_back('/');  break;
                case 'b':  out.push_back('\b'); break;
                case 'f':  out.push_back('\f'); break;
                case 'n':  out.push_back('\n'); break;
                case 'r':  out.push_back('\r'); break;
                case 't':  out.push_back('\t'); break;
                case 'u': {
                    if (i_ + 4 > s_.size()) throw std::runtime_error("bad \\u escape");
                    unsigned cp = static_cast<unsigned>(
                        std::stoul(s_.substr(i_, 4), nullptr, 16));
                    i_ += 4;
                    encodeUtf8(cp, out);          // BMP only — sufficient for Devanagari
                    break;
                }
                default: fail("unknown escape sequence");
            }
        }
        return out;
    }

    static void encodeUtf8(unsigned cp, std::string& out) {
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }

    double parseNumber() {
        size_t start = i_;
        if (i_ < s_.size() && (s_[i_] == '-' || s_[i_] == '+')) ++i_;
        while (i_ < s_.size() &&
               (std::isdigit(static_cast<unsigned char>(s_[i_])) || s_[i_] == '.' ||
                s_[i_] == 'e' || s_[i_] == 'E' || s_[i_] == '+' || s_[i_] == '-'))
            ++i_;
        if (start == i_) fail("expected a number");
        try {
            return std::stod(s_.substr(start, i_ - start));
        } catch (...) {
            fail("malformed number");
        }
    }
};

inline std::string escape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    std::ostringstream os;
                    os << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                       << static_cast<int>(c);
                    out += os.str();
                } else {
                    out.push_back(static_cast<char>(c));
                }
        }
    }
    return out;
}

// Compact fixed-precision emitter — keeps INR values readable downstream.
inline std::string num(double v, int precision = 2) {
    if (!std::isfinite(v)) return "0";
    std::ostringstream os;
    os << std::fixed << std::setprecision(precision) << v;
    return os.str();
}

}  // namespace json

// ══════════════════════════ Domain model ════════════════════════════════════
namespace {

constexpr double kEarthRadiusKm   = 6371.0088;
constexpr double kPi              = 3.14159265358979323846;
constexpr double kDefaultRoadFactor = 1.32;   // great-circle → road distance

struct Vehicle {
    double kmpl              = 8.0;
    double fuelPricePerLitre = 94.5;
    double capacityQuintals  = 0.0;   // 0 ⇒ single trip regardless of volume
    double hireChargePerTrip = 0.0;
    double roadFactor        = kDefaultRoadFactor;
    double avgSpeedKmph      = 32.0;
};

struct MandiInput {
    std::string id;
    std::string name;
    std::string district;
    double lat = 0.0, lon = 0.0;
    double pricePerQuintal = 0.0;
    double handlingFee = 0.0;              // flat INR per visit
    double loadingChargePerQuintal = 0.0;  // hamali / palledari
    double commissionPct = 0.0;            // arhtiya commission on gross
    double distanceKmOverride = -1.0;      // set when caller has road distance
    bool   hasCoords = false;
};

struct MandiResult {
    MandiInput in;
    double distanceKm      = 0.0;
    int    trips           = 1;
    double gross           = 0.0;
    double fuelCost        = 0.0;
    double hireCost        = 0.0;
    double commission      = 0.0;
    double handlingTotal   = 0.0;
    double totalDeductions = 0.0;
    double net             = 0.0;
    double netPerQuintal   = 0.0;
    double travelHoursRT   = 0.0;
    bool   viable          = true;
    std::string verdict;
};

double toRadians(double deg) { return deg * kPi / 180.0; }

double haversineKm(double lat1, double lon1, double lat2, double lon2) {
    const double dLat = toRadians(lat2 - lat1);
    const double dLon = toRadians(lon2 - lon1);
    const double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
                     std::cos(toRadians(lat1)) * std::cos(toRadians(lat2)) *
                     std::sin(dLon / 2) * std::sin(dLon / 2);
    return 2.0 * kEarthRadiusKm * std::asin(std::min(1.0, std::sqrt(a)));
}

Vehicle parseVehicle(const json::Value& root) {
    Vehicle v;
    const json::Value* node = root.find("vehicle");
    if (!node || !node->isObject()) return v;
    v.kmpl              = node->numberOr("kmpl", v.kmpl);
    v.fuelPricePerLitre = node->numberOr("fuelPricePerLitre", v.fuelPricePerLitre);
    v.capacityQuintals  = node->numberOr("capacityQuintals", v.capacityQuintals);
    v.hireChargePerTrip = node->numberOr("hireChargePerTrip", v.hireChargePerTrip);
    v.roadFactor        = node->numberOr("roadFactor", v.roadFactor);
    v.avgSpeedKmph      = node->numberOr("avgSpeedKmph", v.avgSpeedKmph);
    if (v.kmpl <= 0.0)        v.kmpl = 8.0;
    if (v.roadFactor <= 0.0)  v.roadFactor = kDefaultRoadFactor;
    if (v.avgSpeedKmph <= 0)  v.avgSpeedKmph = 32.0;
    return v;
}

MandiInput parseMandi(const json::Value& node, size_t index) {
    MandiInput m;
    m.id       = node.stringOr("id", "mandi_" + std::to_string(index + 1));
    m.name     = node.stringOr("name", m.id);
    m.district = node.stringOr("district", "");
    m.pricePerQuintal         = node.numberOr("pricePerQuintal", 0.0);
    m.handlingFee             = node.numberOr("handlingFee", 0.0);
    m.loadingChargePerQuintal = node.numberOr("loadingChargePerQuintal", 0.0);
    m.commissionPct           = node.numberOr("commissionPct", 0.0);

    if (node.hasKey("lat") && node.hasKey("lon")) {
        m.lat = node.numberOr("lat", 0.0);
        m.lon = node.numberOr("lon", 0.0);
        m.hasCoords = true;
    }
    if (node.hasKey("distanceKm"))
        m.distanceKmOverride = node.numberOr("distanceKm", -1.0);
    return m;
}

MandiResult evaluate(const MandiInput& m, double originLat, double originLon,
                     double volumeQuintals, const Vehicle& veh) {
    MandiResult r;
    r.in = m;

    if (m.distanceKmOverride >= 0.0) {
        r.distanceKm = m.distanceKmOverride;
    } else if (m.hasCoords) {
        r.distanceKm = haversineKm(originLat, originLon, m.lat, m.lon) * veh.roadFactor;
    } else {
        r.distanceKm = 0.0;
    }

    r.trips = 1;
    if (veh.capacityQuintals > 0.0 && volumeQuintals > veh.capacityQuintals)
        r.trips = static_cast<int>(std::ceil(volumeQuintals / veh.capacityQuintals));

    const double fuelPerKm = veh.fuelPricePerLitre / veh.kmpl;

    r.gross         = m.pricePerQuintal * volumeQuintals;
    r.fuelCost      = r.trips * 2.0 * r.distanceKm * fuelPerKm;
    r.hireCost      = r.trips * veh.hireChargePerTrip;
    r.commission    = r.gross * (m.commissionPct / 100.0);
    r.handlingTotal = m.handlingFee * r.trips +
                      m.loadingChargePerQuintal * volumeQuintals;

    r.totalDeductions = r.fuelCost + r.hireCost + r.commission + r.handlingTotal;
    r.net             = r.gross - r.totalDeductions;
    r.netPerQuintal   = volumeQuintals > 0 ? r.net / volumeQuintals : 0.0;
    r.travelHoursRT   = r.trips * (2.0 * r.distanceKm) / veh.avgSpeedKmph;
    r.viable          = r.net > 0.0;
    return r;
}

std::string readAllStdin() {
    std::ostringstream ss;
    ss << std::cin.rdbuf();
    return ss.str();
}

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot open input file: " + path);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

void emitError(const std::string& message) {
    std::cout << "{\"success\":false,\"error\":\"" << json::escape(message) << "\"}"
              << std::endl;
}

}  // namespace

// ══════════════════════════ main ════════════════════════════════════════════
int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);

    std::string payload;
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if ((arg == "--file" || arg == "-f") && i + 1 < argc) {
                payload = readFile(argv[++i]);
            } else if ((arg == "--json" || arg == "-j") && i + 1 < argc) {
                payload = argv[++i];
            } else if (arg == "--version" || arg == "-v") {
                std::cout << "{\"engine\":\"agrisaarthi-mandi-router\",\"version\":\"1.0.0\"}"
                          << std::endl;
                return 0;
            }
        }
        if (payload.empty()) payload = readAllStdin();
        if (payload.find_first_not_of(" \t\r\n") == std::string::npos)
            throw std::runtime_error("empty input payload");
    } catch (const std::exception& e) {
        emitError(e.what());
        return 1;
    }

    json::Value root;
    try {
        root = json::Parser(payload).parse();
    } catch (const std::exception& e) {
        emitError(std::string("JSON parse failure: ") + e.what());
        return 1;
    }

    try {
        if (!root.isObject())
            throw std::runtime_error("root payload must be a JSON object");

        // ── Origin ──
        double originLat = 0.0, originLon = 0.0;
        if (const json::Value* o = root.find("origin"); o && o->isObject()) {
            originLat = o->numberOr("lat", 0.0);
            originLon = o->numberOr("lon", 0.0);
        } else {
            originLat = root.numberOr("lat", 0.0);
            originLon = root.numberOr("lon", 0.0);
        }
        if (originLat < -90.0 || originLat > 90.0 || originLon < -180.0 || originLon > 180.0)
            throw std::runtime_error("origin coordinates out of range");

        const double volume = root.numberOr("volumeQuintals", 0.0);
        if (volume <= 0.0)
            throw std::runtime_error("volumeQuintals must be greater than zero");

        const Vehicle veh = parseVehicle(root);
        const std::string crop = root.stringOr("crop", "");
        const double localPrice = root.numberOr("localPricePerQuintal", 0.0);

        const json::Value* mandisNode = root.find("mandis");
        if (!mandisNode || !mandisNode->isArray() || mandisNode->asArray().empty())
            throw std::runtime_error("mandis must be a non-empty array");

        // ── Evaluate ──
        std::vector<MandiResult> results;
        results.reserve(mandisNode->asArray().size());
        size_t idx = 0;
        for (const json::Value& node : mandisNode->asArray()) {
            if (!node.isObject()) { ++idx; continue; }
            MandiInput mi = parseMandi(node, idx++);
            if (mi.pricePerQuintal <= 0.0) continue;   // no live ticker → skip
            results.push_back(evaluate(mi, originLat, originLon, volume, veh));
        }
        if (results.empty())
            throw std::runtime_error("no mandi entries carried a usable price");

        std::sort(results.begin(), results.end(),
                  [](const MandiResult& a, const MandiResult& b) {
                      if (std::fabs(a.net - b.net) > 0.005) return a.net > b.net;
                      return a.distanceKm < b.distanceKm;
                  });

        const double bestNet    = results.front().net;
        const double worstNet   = results.back().net;
        const double localGross = localPrice > 0.0 ? localPrice * volume : 0.0;

        for (auto& r : results) {
            if (!r.viable) {
                r.verdict = "Loss-making after transport — do not travel.";
            } else if (localGross > 0.0 && r.net <= localGross) {
                r.verdict = "Local sale is better — staying home earns more.";
            } else if (std::fabs(r.net - bestNet) < 0.005) {
                r.verdict = "Best net realisation — recommended.";
            } else {
                r.verdict = "Profitable, but a better option exists.";
            }
        }

        // ── Serialise ──
        std::ostringstream out;
        out << "{\"success\":true,"
            << "\"engine\":\"agrisaarthi-mandi-router\",\"version\":\"1.0.0\","
            << "\"crop\":\"" << json::escape(crop) << "\","
            << "\"volumeQuintals\":" << json::num(volume) << ","
            << "\"origin\":{\"lat\":" << json::num(originLat, 6)
            << ",\"lon\":" << json::num(originLon, 6) << "},"
            << "\"assumptions\":{"
            << "\"kmpl\":" << json::num(veh.kmpl)
            << ",\"fuelPricePerLitre\":" << json::num(veh.fuelPricePerLitre)
            << ",\"fuelCostPerKm\":" << json::num(veh.fuelPricePerLitre / veh.kmpl)
            << ",\"roadFactor\":" << json::num(veh.roadFactor)
            << ",\"vehicleCapacityQuintals\":" << json::num(veh.capacityQuintals)
            << "},\"results\":[";

        for (size_t i = 0; i < results.size(); ++i) {
            const MandiResult& r = results[i];
            if (i) out << ',';
            out << "{\"rank\":" << (i + 1)
                << ",\"id\":\"" << json::escape(r.in.id) << "\""
                << ",\"name\":\"" << json::escape(r.in.name) << "\""
                << ",\"district\":\"" << json::escape(r.in.district) << "\""
                << ",\"pricePerQuintal\":" << json::num(r.in.pricePerQuintal)
                << ",\"distanceKm\":" << json::num(r.distanceKm)
                << ",\"trips\":" << r.trips
                << ",\"grossRevenue\":" << json::num(r.gross)
                << ",\"fuelCost\":" << json::num(r.fuelCost)
                << ",\"hireCost\":" << json::num(r.hireCost)
                << ",\"commission\":" << json::num(r.commission)
                << ",\"handlingCost\":" << json::num(r.handlingTotal)
                << ",\"totalDeductions\":" << json::num(r.totalDeductions)
                << ",\"netProfit\":" << json::num(r.net)
                << ",\"netPerQuintal\":" << json::num(r.netPerQuintal)
                << ",\"roundTripHours\":" << json::num(r.travelHoursRT, 1)
                << ",\"viable\":" << (r.viable ? "true" : "false")
                << ",\"verdict\":\"" << json::escape(r.verdict) << "\"}";
        }
        out << "],";

        const MandiResult& best = results.front();
        out << "\"best\":{\"id\":\"" << json::escape(best.in.id) << "\""
            << ",\"name\":\"" << json::escape(best.in.name) << "\""
            << ",\"netProfit\":" << json::num(best.net)
            << ",\"netPerQuintal\":" << json::num(best.netPerQuintal)
            << ",\"distanceKm\":" << json::num(best.distanceKm) << "},"
            << "\"spreadVsWorst\":" << json::num(bestNet - worstNet) << ",";

        if (localGross > 0.0) {
            const double uplift = bestNet - localGross;
            out << "\"localBaseline\":{"
                << "\"pricePerQuintal\":" << json::num(localPrice)
                << ",\"netProfit\":" << json::num(localGross)
                << ",\"upliftIfTravel\":" << json::num(uplift)
                << ",\"travelRecommended\":" << (uplift > 0.0 ? "true" : "false")
                << "},";
        } else {
            out << "\"localBaseline\":null,";
        }

        out << "\"evaluatedCount\":" << results.size() << "}";
        std::cout << out.str() << std::endl;
        return 0;

    } catch (const std::exception& e) {
        emitError(e.what());
        return 1;
    }
}