plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.rems.thesis"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.rems.thesis"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "1.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Server the app opens on first launch. Empty = built-in Demo Mode (bundled UI + simulated data).
        // Set to the permanent tunnel URL once it exists.
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/demoAssets"))
}

// Bundle the real mobile web UI (backend/templates + backend/static) into the APK for Demo Mode,
// rewriting Flask url_for() tags into relative paths and injecting the simulated API.
val prepareDemoAssets by tasks.registering(Copy::class) {
    val backend = rootProject.file("../backend")
    from(File(backend, "templates/mobile.html")) {
        filter { line ->
            line.replace(Regex("""\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*}}"""), "$1")
                .replace(Regex("""(<script src="mobile\.js[^"]*"></script>)"""), "<script src=\"demo-api.js\"></script>\n    $1")
        }
    }
    from(File(backend, "static")) {
        include("mobile.js", "mobile.css", "manifest.json")
    }
    from(rootProject.file("demo/demo-api.js"))
    into(layout.buildDirectory.dir("generated/demoAssets/demo"))
}
tasks.named("preBuild") { dependsOn(prepareDemoAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
