<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The conversation's messages: user/assistant turns and system notes (e.g. a confirmed
        // page action's outcome, spec §12.3).
        Schema::create('agent_turns', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('conversation_id')->constrained()->cascadeOnDelete();
            $table->string('role', 16);
            $table->text('content');
            $table->json('meta')->nullable();
            // Names of the tools the model could call in this turn (assistant turns only).
            $table->json('tools')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_turns');
    }
};
