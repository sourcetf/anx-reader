# The ML Kit text-recognition plugin references a recogniser for every script it
# can read, but ships only the latin model; the others are added in
# android/app/build.gradle. Chinese, Japanese and Korean are bundled, Devanagari
# is not — the app never asks for it (lib/service/ocr/ocr_service.dart) — so R8
# must not treat its absence as an error while shrinking the release build.
-dontwarn com.google.mlkit.vision.text.devanagari.**
