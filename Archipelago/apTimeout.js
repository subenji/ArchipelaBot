module.exports = function aptimeout(interaction) {
  if (interaction.client.tempData.apInterfaces.has(interaction.channel.id)) {
    /*let message = { type: 'chat', content: 'Disconnecting after 6 hours. Reconnect if required.', };
      interaction.client.tempData.apInterfaces.get(interaction.channel.id).messageQueue.push(message);*/
    let apinterface = interaction.client.tempData.apInterfaces.get(interaction.channel.id);
    if (apinterface.timeoutid < Date.now() - 7200000) {
      apinterface.disconnect();
      interaction.client.tempData.apInterfaces.delete(interaction.channel.id);
    } else {
      setTimeout(aptimeout, 7200000, interaction);
    }
  }
};
