package com.anonchat.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

public class MainActivity extends LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
