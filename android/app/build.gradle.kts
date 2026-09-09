plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.classcard.automation"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.classcard.automation"
        minSdk = 26
        targetSdk = 34
        versionCode = 7
        versionName = "3.0.4"
    }

    buildFeatures {
        buildConfig = true
    }

    /*
     * 고정 서명 키.
     *
     * 기본 debug 키는 빌드하는 기계마다(=CI 러너마다) 새로 만들어지기 때문에,
     * 빌드할 때마다 서명이 달라져 폰에서 "앱이 설치되지 않음"이 뜬다.
     * 저장소에 넣어 둔 키로 항상 같게 서명해, 새 APK 를 덮어 설치할 수 있게 한다.
     *
     * 개인용 앱이라 스토어에 올리지 않으므로 비밀번호를 그대로 둔다.
     * (이 키를 가진 사람은 같은 패키지 이름으로 서명할 수 있으니, 배포용으로는 쓰지 말 것)
     */
    signingConfigs {
        create("shared") {
            storeFile = rootProject.file("keystore/classcard.jks")
            storePassword = "classcard"
            keyAlias = "classcard"
            keyPassword = "classcard"
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    // 문서 시작 스크립트 주입(addDocumentStartJavaScript) + 멀티 프로필(쿠키 격리)
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // 이식 정확성 회귀 테스트용 (원본 파이썬 출력과 대조)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
